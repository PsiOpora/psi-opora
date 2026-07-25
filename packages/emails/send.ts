import { render } from "@react-email/components";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type { ReactNode } from "react";

import { env } from "./env";

const UNISENDER_API_URL =
  "https://go1.unisender.ru/ru/transactional/api/v1/email/send.json";

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
  if (!env.UNISENDER_API_KEY) {
    console.log(
      "Unisender is not configured. You need to add a UNISENDER_API_KEY in your .env file for emails to work.",
    );
    return;
  }
  const { email: fromEmail, name: fromName } = parseFrom(params.from);
  const response = await fetch(UNISENDER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-KEY": env.UNISENDER_API_KEY,
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
  await sendViaUnisender({
    to: email.to,
    from: email.from ?? env.EMAIL_FROM,
    subject: email.subject,
    html,
    attachments: email.attachments,
  });
};

export const sendEmailHtml = async (email: EmailHtml) => {
  await sendViaUnisender({
    to: email.to,
    from: email.from ?? env.EMAIL_FROM,
    subject: email.subject,
    html: email.html,
    attachments: email.attachments,
  });
};
