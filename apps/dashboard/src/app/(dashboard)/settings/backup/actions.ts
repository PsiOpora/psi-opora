"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { tasks } from "@trigger.dev/sdk";
import { env } from "@psi-opora/config";
import { createBackupRun, finishBackupRun } from "@psi-opora/db/queries";
import type { crmBackup } from "@psi-opora/jobs";
import { executeCrmBackup } from "@psi-opora/jobs";
import { MEMBER_ID_COOKIE, getBitrixApi } from "@/lib/bitrix/session";

export interface RunBackupResult {
  ok: boolean;
  runId: string;
  error?: string;
}

export async function runBackupNowAction(): Promise<RunBackupResult> {
  // Создаём запись сразу же, чтобы бэкап появился в истории и в прогрессе
  // в тот же момент, когда пользователь нажал кнопку, а не когда фоновое
  // задание в итоге стартует.
  const runId = crypto.randomUUID();
  await createBackupRun(runId);

  let result: RunBackupResult = { ok: true, runId };

  // Основной путь — фоновое задание trigger.dev: экшен только ставит его
  // в очередь, сам бэкап идёт вне лимитов serverless-функции.
  if (env.TRIGGER_SECRET_KEY) {
    const store = await cookies();
    const memberId = store.get(MEMBER_ID_COOKIE)?.value;
    try {
      await tasks.trigger<typeof crmBackup>("crm-backup", { memberId, runId });
    } catch (err) {
      // Задание не поставлено — фиксируем в истории, чтобы ошибка
      // была видна в таблице запусков.
      const error = `Не удалось запустить фоновое задание: ${(err as Error).message}`;
      await finishBackupRun(runId, { status: "error", error });
      result = { ok: false, runId, error };
    }
  } else {
    // Fallback без trigger.dev (локальная разработка) — инлайн.
    try {
      const api = await getBitrixApi();
      if (!api) throw new Error("Bitrix24 не подключён");
      await executeCrmBackup(api, runId);
    } catch (err) {
      // Ошибка уже записана в backup_runs — покажется в таблице истории.
      result = { ok: false, runId, error: (err as Error).message };
    }
  }

  revalidatePath("/settings/backup");
  return result;
}
