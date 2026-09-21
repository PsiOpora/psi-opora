/**
 * Разовый бэкафилл расхода из Яндекс.Директ в ad_daily_stats
 * (packages/db/src/schema/ads) за широкое историческое окно. Обычный крон
 * (packages/jobs/src/hatchet/ads-stats-sync.ts) держит свежими только
 * последние 7 дней — без бэкафилла отчёт «Атрибуция» (/attribution) покажет
 * «нет данных» по расходу для периодов до включения крона.
 *
 * Запуск (из корня репозитория, с доступом к POSTGRES_URL и настроенными
 * учётками в /settings/ads):
 *   bun --env-file=.env run scripts/backfill-ads-stats.ts [дней]
 *
 * По умолчанию — 90 дней назад от сегодня.
 */
import { fetchAdStats } from "@psi-opora/bot-core";
import { getAdCredentials } from "@psi-opora/db/queries";

async function main() {
	const days = Number(process.argv[2]) || 90;

	const creds = await getAdCredentials();
	if (!creds) {
		throw new Error(
			"Учётки рекламных кабинетов не настроены — заполните /settings/ads",
		);
	}

	const today = new Date();
	const dateTo = today.toISOString().split("T")[0] ?? "";
	const dateFrom =
		new Date(today.getTime() - days * 24 * 60 * 60 * 1000)
			.toISOString()
			.split("T")[0] ?? "";

	console.log(`Бэкафилл расхода за ${dateFrom} — ${dateTo}…`);
	const result = await fetchAdStats(null, creds, dateFrom, dateTo);
	console.log(
		`Готово: ${result.campaigns.length} кампаний, расход ${result.totalSpend}, показы ${result.totalImpressions}, клики ${result.totalClicks}.`,
	);
}

await main();
