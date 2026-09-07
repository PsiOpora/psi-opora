/**
 * Разовый полный бэкафилл локального зеркала сделок Bitrix24 (packages/db,
 * таблица deals). Гоняется вручную один раз, перед тем как включать
 * периодическую сверку (packages/jobs/src/hatchet/deals-sync.ts) — та
 * полагается на уже непустую таблицу и синхронизирует только изменения.
 *
 * Запуск (из корня репозитория, с доступом к POSTGRES_URL и BITRIX_MEMBER_ID):
 *   bun --env-file=.env run scripts/backfill-deals.ts
 */
// scripts/ не зарегистрирован как workspace-пакет (нет node_modules/@psi-opora/*
// в корне под него) — импортируем исходники пакетов напрямую по относительному
// пути, как и другие скрипты в этой папке (см. backfill-start-utm.ts). Их
// собственные внутренние импорты @psi-opora/* резолвятся нормально — каждый
// пакет уже хранит свои зависимости в собственном node_modules.
import { resolveBitrixApi } from "../packages/bitrix-client/src/client";
import { env } from "../packages/config/src/env";
import {
	syncAllDeals,
	syncDealDictionaries,
} from "../packages/jobs/src/deals-sync";

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

	console.log("Синхронизация справочников (источники/стадии/воронки)…");
	await syncDealDictionaries(api);
	console.log("Готово.");
}

await main();
