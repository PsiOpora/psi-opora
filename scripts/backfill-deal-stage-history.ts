/**
 * Разовый бэкафилл истории переходов сделок по стадиям (packages/db, таблица
 * deal_stage_history). Гоняется вручную один раз перед тем, как включать
 * периодическую синхронизацию (packages/jobs/src/hatchet/deal-stage-history-sync.ts) —
 * та работает по тому же курсору и просто продолжит с места, где остановился
 * этот скрипт.
 *
 * Запуск (из корня репозитория, с доступом к POSTGRES_URL и BITRIX_MEMBER_ID):
 *   bun --env-file=.env run scripts/backfill-deal-stage-history.ts
 */
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { syncStageHistory } from "@psi-opora/jobs";

async function main() {
	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!api) {
		throw new Error(
			"Bitrix24 не подключён — проверьте BITRIX_MEMBER_ID/сохранённые OAuth-токены",
		);
	}

	console.log("Бэкафилл истории стадий сделок — старт…");
	const result = await syncStageHistory(api, (synced) => {
		console.log(`  синхронизировано ${synced}`);
	});
	console.log(`Готово: ${result.synced} записей истории.`);
}

await main();
