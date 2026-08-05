import { db } from "../client";
import { emailProviderSettings } from "../schema/email-provider";

export type EmailProvider = "rusender" | "unisender";

const DEFAULT_PROVIDER: EmailProvider = "rusender";

/** Активный провайдер email-отправки (транзакционные письма и CRM-рассылки). По умолчанию — Rusender. */
export async function getEmailProvider(): Promise<EmailProvider> {
  if (!db) return DEFAULT_PROVIDER;
  const rows = await db.select().from(emailProviderSettings).limit(1);
  const provider = rows[0]?.provider;
  return provider === "unisender" ? "unisender" : DEFAULT_PROVIDER;
}

export async function setEmailProvider(
  provider: EmailProvider,
): Promise<void> {
  if (!db) return;
  await db
    .insert(emailProviderSettings)
    .values({ id: "singleton", provider })
    .onConflictDoUpdate({
      target: emailProviderSettings.id,
      set: { provider },
    });
}
