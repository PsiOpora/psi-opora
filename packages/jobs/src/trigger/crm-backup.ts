import { queue, task } from "@trigger.dev/sdk";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { executeCrmBackup } from "../backup";

export interface CrmBackupPayload {
  /** member_id портала Bitrix24 (OAuth); без него — dev-вебхук из env. */
  memberId?: string;
  /** id уже созданной записи в backup_runs (см. runBackupNowAction). */
  runId?: string;
}

// Один бэкап за раз: параллельные запуски (cron + ручной) лишь дублируют
// архивы и нагрузку на REST API Bitrix24.
const backupQueue = queue({
  name: "crm-backup",
  concurrencyLimit: 1,
});

/** Фоновое задание: полный бэкап CRM Bitrix24 в S3-хранилище. */
export const crmBackup = task({
  id: "crm-backup",
  queue: backupQueue,
  maxDuration: 3600,
  run: async (payload: CrmBackupPayload) => {
    const api = resolveBitrixApi(payload.memberId);
    if (!api) throw new Error("Bitrix24 не подключён");
    return executeCrmBackup(api, payload.runId);
  },
});
