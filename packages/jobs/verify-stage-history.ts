import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { syncStageHistory } from "./src/deal-stage-history-sync";

async function main() {
	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!api) throw new Error("Bitrix24 не подключён");
	console.log("Бэкафилл истории стадий сделок — старт…");
	const result = await syncStageHistory(api, (synced) => {
		console.log(`  синхронизировано ${synced}`);
	});
	console.log(`Готово: ${result.synced} записей истории.`);
}

await main();
