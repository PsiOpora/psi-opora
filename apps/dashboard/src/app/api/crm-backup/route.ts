import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { env } from "@psi-opora/config";
import type { crmBackup } from "@psi-opora/jobs";
import { executeCrmBackup } from "@psi-opora/jobs";
import { getBitrixApi } from "@/lib/bitrix/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Основной путь — ставим фоновое задание trigger.dev и сразу отвечаем.
    if (env.TRIGGER_SECRET_KEY) {
      const handle = await tasks.trigger<typeof crmBackup>("crm-backup", {});
      return NextResponse.json({ ok: true, triggered: true, id: handle.id });
    }

    // Fallback без trigger.dev — выполняем инлайн (в пределах maxDuration).
    const api = await getBitrixApi();
    if (!api) {
      return NextResponse.json(
        { ok: false, error: "Bitrix24 не подключён" },
        { status: 400 },
      );
    }

    const result = await executeCrmBackup(api);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[crm-backup] error:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
