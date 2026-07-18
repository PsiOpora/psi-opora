import { GuideEmail, sendEmail } from "@psi-opora/emails";
import type { GuideFile } from "../scenario/texts";

/**
 * Отправляет PDF-гайд на email вложением через общий пакет @psi-opora/emails.
 * Без RESEND_API_KEY (и без sandbox-режима) пакет сам молча пропускает
 * отправку — гайд уже ушёл в чат.
 */
export async function sendGuideEmail(
  to: string,
  guide: GuideFile,
  subject: string,
  body: string,
): Promise<void> {
  const fileRes = await fetch(guide.url);
  if (!fileRes.ok) throw new Error(`гайд недоступен: HTTP ${fileRes.status}`);
  const bytes = new Uint8Array(await fileRes.arrayBuffer());

  await sendEmail({
    to: [to],
    subject,
    react: GuideEmail({ subject, body }),
    attachments: [{ filename: guide.name, content: Buffer.from(bytes) }],
  });
}
