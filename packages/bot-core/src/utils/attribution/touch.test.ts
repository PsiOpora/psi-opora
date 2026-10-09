import { describe, expect, test } from "bun:test";
import { normalizeTouchPayload, touchPayloadSchema } from "./touch";

const NOW = new Date("2026-10-09T10:00:00Z");
const CLIENT_ID = "163972457524306386";

function normalize(payload: Record<string, unknown>) {
	return normalizeTouchPayload(touchPayloadSchema.parse(payload), NOW);
}

describe("normalizeTouchPayload", () => {
	test("раскладывает метки Директа и макросы по полям касания", () => {
		const touch = normalize({
			clientId: CLIENT_ID,
			yclid: "9876543210987654321",
			utm_source: "Yandex",
			utm_medium: "CPC",
			utm_campaign: "search_anorexia_708811857",
			utm_content: "17000000123",
			utm_term: "анорексия лечение",
			gbid: "5600000111",
			phrase_id: "1234567890",
			landingUrl: "https://psi-opora.ru/anorexia/?utm_source=yandex",
			referrer: "https://yandex.ru/",
		});
		expect(touch).toMatchObject({
			ymClientId: CLIENT_ID,
			yclid: "9876543210987654321",
			utmSource: "yandex",
			utmMedium: "cpc",
			utmCampaign: "search_anorexia_708811857",
			utmContent: "17000000123",
			utmTerm: "анорексия лечение",
			// ID кампании выводится из числового хвоста метки, ID объявления — из utm_content
			adCampaignId: "708811857",
			adId: "17000000123",
			adGroupId: "5600000111",
			keywordId: "1234567890",
			occurredAt: NOW,
		});
		expect(touch?.id).toBeString();
	});

	test("явные макросы campaign_id/ad_id важнее значений, выведенных из utm_*", () => {
		const touch = normalize({
			clientId: CLIENT_ID,
			utm_source: "yandex",
			utm_campaign: "rsya_retarget_anorexia_v2",
			campaign_id: "712406846",
			utm_content: "banner_blue",
			ad_id: "17000000999",
		});
		expect(touch).toMatchObject({
			adCampaignId: "712406846",
			adId: "17000000999",
			utmContent: "banner_blue",
		});
	});

	test("числовой utm_campaign (макрос {campaign_id}) сам становится ID кампании", () => {
		const touch = normalize({
			clientId: CLIENT_ID,
			utm_source: "yandex",
			utm_campaign: "708811857",
		});
		expect(touch?.adCampaignId).toBe("708811857");
	});

	test("yclid без меток считается платным заходом из Директа", () => {
		const touch = normalize({ yclid: "9876543210987654321" });
		expect(touch).toMatchObject({
			utmSource: "yandex",
			utmMedium: "cpc",
			ymClientId: null,
		});
	});

	test("нераскрытые макросы и мусор в метки не попадают", () => {
		const touch = normalize({
			clientId: CLIENT_ID,
			utm_source: "yandex",
			utm_campaign: "{campaign_id}",
			utm_content: "{ad_id}",
			utm_term: "{keyword}",
			gbid: "{gbid}",
			phrase_id: "не число",
		});
		expect(touch).toMatchObject({
			utmCampaign: null,
			utmContent: null,
			utmTerm: null,
			adGroupId: null,
			keywordId: null,
			adId: null,
		});
	});

	test("без ClientID и yclid касание не к кому привязать", () => {
		expect(normalize({ utm_source: "yandex" })).toBeNull();
		expect(normalize({ clientId: "abc", utm_source: "yandex" })).toBeNull();
	});

	test("заход без рекламных признаков не сохраняется", () => {
		expect(
			normalize({ clientId: CLIENT_ID, landingUrl: "https://psi-opora.ru/" }),
		).toBeNull();
	});

	test("ClientID можно прислать числом, длинные значения обрезаются", () => {
		const touch = normalize({
			clientId: Number("1639724575243063"),
			utm_source: "yandex",
			utm_term: "я".repeat(500),
		});
		expect(touch?.ymClientId).toBe("1639724575243063");
		expect(touch?.utmTerm).toHaveLength(200);
	});

	test("вычищает управляющие символы", () => {
		const touch = normalize({
			clientId: CLIENT_ID,
			utm_source: "yandex",
			utm_campaign: "a\u0000b\nc",
		});
		expect(touch?.utmCampaign).toBe("a b c");
	});
});
