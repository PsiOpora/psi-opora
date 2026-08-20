/**
 * Разовый полный бэкафилл локального зеркала сделок Bitrix24 (packages/db,
 * таблица deals). Гоняется вручную один раз, перед тем как включать
 * периодическую сверку (packages/jobs/src/hatchet/deals-sync.ts) — та
 * полагается на уже непустую таблицу и синхронизирует только изменения.
 *
 * Запуск (из корня репозитория, с доступом к POSTGRES_URL и BITRIX_MEMBER_ID):
 *   bun --env-file=.env run scripts/backfill-deals.ts
 */
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { syncAllDeals } from "@psi-opora/jobs";

async function main() {
	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!api) {
		throw new Error(
			"Bitrix24 не подключён — проверьте BITRIX_MEMBER_ID/сохранённые OAuth-токены",
		);
	}

	console.log("Бэкафилл сделок — старт…");
	const result = await syncAllDeals(api, (synced, total) => {
		console.log(`  синхронизировано ${synced} из ${total}`);
	});
	console.log(`Готово: ${result.synced} сделок.`);
}

await main();
