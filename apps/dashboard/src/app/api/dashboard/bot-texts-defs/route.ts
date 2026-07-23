import {
  GUIDE_FILE_S3_KEY,
  SCENARIO_TEXT_DEFS,
} from "@psi-opora/bot-core";
import { NextResponse } from "next/server";

/**
 * Статические определения текстов сценария бота — отдаём через API, а не
 * импортом @psi-opora/bot-core в клиентский компонент напрямую: этот пакет
 * тянет за собой @psi-opora/emails → nodemailer (Node-only модули net/tls),
 * что ломает сборку клиентского бандла страницы /settings/bot.
 */
export async function GET() {
  return NextResponse.json({
    defs: SCENARIO_TEXT_DEFS,
    guideFileS3Key: GUIDE_FILE_S3_KEY,
  });
}
