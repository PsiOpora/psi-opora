import { NextResponse } from "next/server";
import { env } from "@psi-opora/config";
import {
  createBackupRun,
  finishBackupRun,
  getBackupCredentials,
} from "@psi-opora/db/queries";
import { runCrmBackup } from "@/lib/backup/crm-backup";
import { getBitrixApi } from "@/lib/bitrix/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = crypto.randomUUID();

  try {
    const [api, creds] = await Promise.all([
      getBitrixApi(),
      getBackupCredentials(),
    ]);

    if (!api) {
      return NextResponse.json(
        { ok: false, error: "Bitrix24 не подключён" },
        { status: 400 },
      );
    }
    if (!creds) {
      return NextResponse.json(
        { ok: false, error: "Не настроено S3-хранилище для бэкапа" },
        { status: 400 },
      );
    }

    await createBackupRun(runId);
    const result = await runCrmBackup(api, creds);
    await finishBackupRun(runId, {
      status: "success",
      entities: result.entities,
      objectKey: result.objectKey,
      sizeBytes: result.sizeBytes,
    });

    return NextResponse.json({ ok: true, runId, ...result });
  } catch (err) {
    const error = (err as Error).message;
    console.error("[crm-backup] error:", err);
    await finishBackupRun(runId, { status: "error", error });
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
