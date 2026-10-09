import { beforeAll, describe, expect, test } from "bun:test";

// Нужна одноразовая БД с применёнными миграциями; тест пишет строки с
// уникальными ClientID и ничего не чистит. Без URL — пропускается.
//   AD_TOUCHES_TEST_DATABASE_URL=postgres://… bun test ad-touches.integration
const url = process.env.AD_TOUCHES_TEST_DATABASE_URL;

describe.skipIf(!url)("ad-touches (PostgreSQL)", () => {
	let queries: typeof import("./ad-touches");

	beforeAll(async () => {
		process.env.POSTGRES_URL = url;
		queries = await import("./ad-touches");
	});

	const uid = () => String(Math.floor(Math.random() * 1e15) + 1e17);
	const at = (iso: string) => new Date(iso);

	function touch(
		overrides: Partial<import("./ad-touches").NewAdTouch> & {
			ymClientId: string;
		},
	): import("./ad-touches").NewAdTouch {
		return {
			id: crypto.randomUUID(),
			utmSource: "yandex",
			utmMedium: "cpc",
			utmCampaign: "708811857",
			adId: "17000000123",
			occurredAt: at("2026-10-09T10:00:00Z"),
			...overrides,
		};
	}

	test("сохраняет касание и находит его по ClientID", async () => {
		const ymClientId = uid();
		const t = touch({ ymClientId });
		expect(await queries.insertAdTouch(t)).toEqual({ inserted: true });

		const found = await queries.listAdTouchesForClient({
			ymClientId,
			since: at("2026-10-01T00:00:00Z"),
		});
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({
			id: t.id,
			utmCampaign: "708811857",
			adId: "17000000123",
		});
	});

	test("повтор тех же меток в течение 30 минут — не новое касание", async () => {
		const ymClientId = uid();
		await queries.insertAdTouch(touch({ ymClientId }));
		const again = await queries.insertAdTouch(
			touch({ ymClientId, occurredAt: at("2026-10-09T10:20:00Z") }),
		);
		expect(again).toEqual({ inserted: false });

		// через час — это уже новый визит
		const later = await queries.insertAdTouch(
			touch({ ymClientId, occurredAt: at("2026-10-09T11:30:00Z") }),
		);
		expect(later).toEqual({ inserted: true });
	});

	test("другое объявление в течение 30 минут — отдельное касание", async () => {
		const ymClientId = uid();
		await queries.insertAdTouch(touch({ ymClientId }));
		const other = await queries.insertAdTouch(
			touch({
				ymClientId,
				adId: "17000000999",
				occurredAt: at("2026-10-09T10:05:00Z"),
			}),
		);
		expect(other).toEqual({ inserted: true });
	});

	test("NULL-метки сравниваются как равные (is not distinct from)", async () => {
		const ymClientId = uid();
		const bare = { ymClientId, utmCampaign: null, adId: null, utmMedium: null };
		await queries.insertAdTouch(touch(bare));
		expect(
			await queries.insertAdTouch(
				touch({ ...bare, occurredAt: at("2026-10-09T10:10:00Z") }),
			),
		).toEqual({ inserted: false });
	});

	test("цепочка идёт от старых к новым, берутся последние N в окне", async () => {
		const ymClientId = uid();
		const days = ["01", "03", "05", "07"];
		for (const day of days) {
			await queries.insertAdTouch(
				touch({
					ymClientId,
					utmCampaign: `c${day}`,
					occurredAt: at(`2026-10-${day}T10:00:00Z`),
				}),
			);
		}
		const all = await queries.listAdTouchesForClient({
			ymClientId,
			since: at("2026-10-02T00:00:00Z"),
		});
		expect(all.map((t) => t.utmCampaign)).toEqual(["c03", "c05", "c07"]);

		const lastTwo = await queries.listAdTouchesForClient({
			ymClientId,
			since: at("2026-10-01T00:00:00Z"),
			limit: 2,
		});
		expect(lastTwo.map((t) => t.utmCampaign)).toEqual(["c05", "c07"]);
	});

	test("находит касания и по yclid, если ClientID не захватился", async () => {
		const yclid = uid();
		const ymClientId = uid();
		await queries.insertAdTouch(touch({ ymClientId: uid(), yclid }));
		const byYclid = await queries.listAdTouchesForClient({
			ymClientId,
			yclid,
			since: at("2026-10-01T00:00:00Z"),
		});
		expect(byYclid).toHaveLength(1);
	});

	test("без идентификаторов ничего не ищет", async () => {
		expect(
			await queries.listAdTouchesForClient({
				since: at("2026-10-01T00:00:00Z"),
			}),
		).toEqual([]);
	});

	test("справочник названий: upsert обновляет имя, чтение по ID", async () => {
		const id = uid();
		await queries.upsertAdEntities([
			{ platform: "yandex", kind: "ad", externalId: id, name: "Старое" },
			{
				platform: "yandex",
				kind: "campaign",
				externalId: id,
				name: "Кампания",
			},
		]);
		await queries.upsertAdEntities([
			{ platform: "yandex", kind: "ad", externalId: id, name: "Новое" },
		]);
		const rows = await queries.getAdEntities("yandex", [id]);
		expect(rows.map((r) => [r.kind, r.name]).sort()).toEqual([
			["ad", "Новое"],
			["campaign", "Кампания"],
		]);
	});

	test("привязка касаний к сделке идемпотентна", async () => {
		const dealId = String(Math.floor(Math.random() * 1e9));
		const touches = [
			{ touchId: crypto.randomUUID(), role: "first" as const },
			{ touchId: crypto.randomUUID(), role: "last" as const },
		];
		await queries.insertDealTouches(dealId, touches);
		await queries.insertDealTouches(dealId, touches);
		expect((await queries.listDealTouchIds(dealId)).sort()).toEqual(
			touches.map((t) => t.touchId).sort(),
		);
	});

	test("ссылки на сущности свежих касаний для крона", async () => {
		const ymClientId = uid();
		await queries.insertAdTouch(
			touch({
				ymClientId,
				adCampaignId: "708811857",
				adGroupId: "5600000111",
				keywordId: "1234567890",
				occurredAt: at("2026-10-09T10:00:00Z"),
			}),
		);
		const refs = await queries.listAdTouchEntityRefsSince(
			at("2026-10-09T00:00:00Z"),
		);
		expect(refs).toContainEqual({
			adCampaignId: "708811857",
			adGroupId: "5600000111",
			adId: "17000000123",
			keywordId: "1234567890",
		});
	});
});
