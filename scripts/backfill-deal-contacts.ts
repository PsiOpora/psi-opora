/**
 * Разовый бэкафилл contact_id на уже засинканных сделках (packages/db,
 * таблица deals) — колонка появилась позже самих сделок
 * (packages/db/src/schema/deals/index.ts), поэтому у существующих строк она
 * пустая, пока сделка не изменится и не пересинкуется сама. Нужен для
 * отчёта "новые/повторные клиенты" на /attribution
 * (packages/db/src/queries/deals.ts::getClientAcquisitionByCampaign).
 *
 * Запуск (из корня репозитория, с доступом к POSTGRES_URL и BITRIX_MEMBER_ID):
 *   bun --env-file=.env run scripts/backfill-deal-contacts.ts
 */
import { z } from "zod";
// scripts/ не зарегистрирован как workspace-пакет — импортируем исходники
// пакетов напрямую по относительному пути, как и другие скрипты в этой папке
// (см. backfill-deals.ts).
import { resolveBitrixApi } from "../packages/bitrix-client/src/client";
import { env } from "../packages/config/src/env";
import { updateDealContactIds } from "../packages/db/src/queries/deals";

const rowSchema = z.object({
	ID: z.string(),
	CONTACT_ID: z.string().nullish(),
});

async function main() {
	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!api) {
		throw new Error(
			"Bitrix24 не подключён — проверьте BITRIX_MEMBER_ID/сохранённые OAuth-токены",
		);
	}

	console.log("Бэкафилл contact_id — старт…");
	const raw = await api.list<unknown>("crm.deal.list", {
		select: ["ID", "CONTACT_ID"],
	});
	const rows = z.array(rowSchema).parse(raw);
	const pairs = rows.map((row) => ({
		id: row.ID,
		contactId: row.CONTACT_ID || null,
	}));
	await updateDealContactIds(pairs);
	console.log(`Готово: обновлено ${pairs.length} сделок.`);
}

await main();
