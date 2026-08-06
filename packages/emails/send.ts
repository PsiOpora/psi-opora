import { render } from "@react-email/components";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type { ReactNode } from "react";

import {
  getEmailProvider,
  getResendSettings,
  getRusenderSettings,
  getSmtpBzSettings,
  getUnisenderSettings,
} from "@psi-opora/db/queries";

import { env } from "./env";

const UNISENDER_API_URL =
  "https://go1.unisender.ru/ru/transactional/api/v1/email/send.json";
const RUSENDER_API_BASE = "https://api.rusender.ru/api/v1";
const SMTP_BZ_API_URL = "https://api.smtp.bz/v1/messages";
const RESEND_API_URL = "https://api.resend.com/emails";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface Emails {
  react: ReactNode;
  subject: string;
  to: string[];
  from?: string;
  attachments?: EmailAttachment[];
}

export type EmailHtml = {
  html: string;
  subject: string;
  to: string[];
  from?: string;
  attachments?: EmailAttachment[];
};

function parseFrom(from: string): { email: string; name?: string } {
  const match = /^(.*)<(.+)>$/.exec(from);
  if (!match?.[2]) return { email: from.trim() };
  return { email: match[2].trim(), name: match[1]?.trim() || undefined };
}

async function sendViaUnisender(params: {
  to: string[];
  from: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}) {
  const settings = await getUnisenderSettings().catch(() => null);
  const apiKey = settings?.apiKey ?? env.UNISENDER_API_KEY;
  if (!apiKey) {
    console.log(
      "Unisender is not configured. You need to add a UNISENDER_API_KEY (or set it in /settings/email) for emails to work.",
    );
    return;
  }
  const { email: fromEmail, name: fromName } = parseFrom(params.from);
  const response = await fetch(UNISENDER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      message: {
        recipients: params.to.map((email) => ({ email })),
        subject: params.subject,
        from_email: fromEmail,
        from_name: fromName,
        body: { html: params.html },
        attachments: params.attachments?.map((attachment) => ({
          type: "application/octet-stream",
          name: attachment.filename,
          content: attachment.content.toString("base64"),
        })),
      },
    }),
  });
  const result = (await response.json()) as {
    status: "success" | "error";
    message?: string;
  };
  if (!response.ok || result.status === "error") {
    throw new Error(result.message ?? "Unisender request failed");
  }
}

async function sendViaRusender(params: {
  to: string[];
  from: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}) {
  const settings = await getRusenderSettings().catch(() => null);
  if (!settings?.apiKey || !settings.keyId) {
    throw new Error(
      "Rusender is not configured. Add an API key and key ID in /settings/email for emails to work.",
    );
  }
  const { email: fromEmail, name: fromName } = parseFrom(params.from);
  for (const email of params.to) {
    const response = await fetch(
      `${RUSENDER_API_BASE}/external-mails/send/${settings.keyId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          mail: {
            to: { email },
            from: { email: fromEmail, name: fromName },
            subject: params.subject,
            html: params.html,
            // У Rusender attachments — не массив, а объект { имяФайла: base64 },
            // в отличие от Unisender выше; массив [{name, content}] Rusender
            // молча превращает в файл с буквальным именем "name" и пустым телом.
            attachments: params.attachments?.length
              ? Object.fromEntries(
                  params.attachments.map((attachment) => [
                    attachment.filename,
                    attachment.content.toString("base64"),
                  ]),
                )
              : undefined,
          },
        }),
      },
    );
    const result = (await response.json().catch(() => ({}))) as {
      uuid?: string;
      message?: string;
    };
    if (!response.ok || !result.uuid) {
      throw new Error(result.message ?? "Rusender request failed");
    }
  }
}

async function sendViaSmtpBz(params: {
  to: string[];
  from: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}) {
  const settings = await getSmtpBzSettings().catch(() => null);
  if (!settings?.apiKey) {
    throw new Error(
      "SMTP.BZ is not configured. Add an API key in /settings/email for emails to work.",
    );
  }
  const { email: fromEmail, name: fromName } = parseFrom(params.from);
  const senderEmail = settings.senderEmail ?? fromEmail;
  const senderName = settings.senderName ?? fromName;
  for (const email of params.to) {
    const response = await fetch(SMTP_BZ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: settings.apiKey,
      },
      body: JSON.stringify({
        from: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
        to: email,
        subject: params.subject,
        html: params.html,
        attachments: params.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content.toString("base64"),
        })),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(
        result.message ?? result.error ?? "SMTP.BZ request failed",
      );
    }
  }
}

async function sendViaResend(params: {
  to: string[];
  from: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}) {
  const settings = await getResendSettings().catch(() => null);
  if (!settings?.apiKey) {
    throw new Error(
      "Resend is not configured. Add an API key in /settings/email for emails to work.",
    );
  }
  const { email: fromEmail, name: fromName } = parseFrom(params.from);
  const senderEmail = settings.senderEmail ?? fromEmail;
  const senderName = settings.senderName ?? fromName;
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      from: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
      attachments: params.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content.toString("base64"),
      })),
    }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (!response.ok || !result.id) {
    throw new Error(result.message ?? "Resend request failed");
  }
}

/**
 * У Rusender/Unisender это основной выбранный в /settings/email провайдер.
 * Если основной — Rusender и отправка через него не удалась (сбой, письмо
 * не ушло), пробуем по очереди резервные провайдеры: SMTP.BZ, затем Resend.
 * Unisender резервных провайдеров не имеет — как отдельный основной
 * провайдер он не участвует в этой цепочке.
 */
async function sendViaProvider(params: {
  to: string[];
  from: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}) {
  const provider = await getEmailProvider();
  if (provider === "unisender") return sendViaUnisender(params);

  const chain: Array<{
    name: string;
    send: (p: typeof params) => Promise<void>;
  }> = [
    { name: "Rusender", send: sendViaRusender },
    { name: "SMTP.BZ", send: sendViaSmtpBz },
    { name: "Resend", send: sendViaResend },
  ];

  const errors: string[] = [];
  for (const { name, send } of chain) {
    try {
      await send(params);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: ${message}`);
      console.warn(`Email send via ${name} failed, trying next provider. ${message}`);
    }
  }
  throw new Error(`All email providers failed. ${errors.join(" | ")}`);
}

export const sendEmail = async (email: Emails) => {
  const html = await render(email.react);
  if (env.EMAIL_SANDBOX_ENABLED) {
    const mailOptions: Mail.Options = {
      from: email.from ?? env.EMAIL_FROM,
      to: email.to,
      html,
      subject: email.subject,
      attachments: email.attachments,
    };
    const transporter = nodemailer.createTransport({
      host: env.EMAIL_SANDBOX_HOST,
      secure: false,
      port: 2500,
    });
    return transporter.sendMail(mailOptions);
  }
  await sendViaProvider({
    to: email.to,
    from: email.from ?? env.EMAIL_FROM,
    subject: email.subject,
    html,
    attachments: email.attachments,
  });
};

export const sendEmailHtml = async (email: EmailHtml) => {
  await sendViaProvider({
    to: email.to,
    from: email.from ?? env.EMAIL_FROM,
    subject: email.subject,
    html: email.html,
    attachments: email.attachments,
  });
};
