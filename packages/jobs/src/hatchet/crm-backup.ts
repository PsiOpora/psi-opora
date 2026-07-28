import {
  ConcurrencyLimitStrategy,
  CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { executeCrmBackup } from "../backup";

export interface CrmBackupPayload {
  /** member_id портала Bitrix24 (OAuth); без него — dev-вебхук из env. */
  memberId?: string;
  /** id уже созданной записи в backup_runs (см. runBackupNowAction). */
  runId?: string;
}

const backupConcurrency = {
  expression: "'crm-backup'",
  maxRuns: 1,
  limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
} as const;

/** Фоновое задание: полный бэкап CRM Bitrix24 в S3-хранилище. */
export const crmBackup = CreateTaskWorkflow({
  name: "crm-backup",
  retries: 0,
  executionTimeout: "1h",
  scheduleTimeout: "24h",
  // Один бэкап за раз: параллельные запуски (cron + ручной) лишь дублируют
  // архивы и нагрузку на REST API Bitrix24.
  concurrency: backupConcurrency,
  fn: async (payload: CrmBackupPayload) => {
    const api = resolveBitrixApi(payload.memberId);
    if (!api) throw new Error("Bitrix24 не подключён");
    return executeCrmBackup(api, payload.runId);
  },
});

/**
 * Ночной запуск бэкапа по расписанию. Раньше за это отвечал Vercel Cron
 * (`/api/crm-backup`), но dashboard задеплоен в k3s, а не на Vercel — тот
 * cron физически не вызывается. Живёт здесь же, в Hatchet, как и
 * остальные периодические задачи (см. diagnostic-reminders.ts).
 */
export const crmBackupSchedule = CreateTaskWorkflow({
  name: "crm-backup-schedule",
  on: { cron: "0 0 * * *" },
  retries: 0,
  executionTimeout: "1h",
  scheduleTimeout: "24h",
  concurrency: backupConcurrency,
  fn: async () => {
    const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
    if (!api) throw new Error("Bitrix24 не подключён");
    return executeCrmBackup(api);
  },
});
