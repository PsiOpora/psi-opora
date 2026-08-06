import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../client";
import {
  emailCampaignRecipients,
  emailCampaigns,
} from "../schema/email-campaign";

export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type EmailCampaignRecipientRow =
  typeof emailCampaignRecipients.$inferSelect;
export type NewEmailCampaignRecipient =
  typeof emailCampaignRecipients.$inferInsert;

export async function createEmailCampaign(data: {
  id: string;
  stageId: string;
  stageName?: string;
  templateId: string;
  templateName?: string;
  subject: string;
  senderEmail: string;
  senderName?: string;
  provider: "unisender" | "rusender";
  totalDeals?: number;
}): Promise<void> {
  if (!db) return;
  await db.insert(emailCampaigns).values({ ...data, status: "queued" });
}

/** Сохраняет id списка/письма/кампании Unisender после успешного запуска рассылки. */
export async function setEmailCampaignUnisenderIds(
  id: string,
  data: {
    unisenderListId: string;
    unisenderMessageId: string;
    unisenderCampaignId: string;
    recipientsCount: number;
  },
): Promise<void> {
  if (!db) return;
  await db
    .update(emailCampaigns)
    .set({ ...data, status: "running" })
    .where(eq(emailCampaigns.id, id));
}

export async function updateEmailCampaignStats(
  id: string,
  data: {
    sentCount?: number;
    openedCount?: number;
    clickedCount?: number;
    unsubscribedCount?: number;
  },
): Promise<void> {
  if (!db) return;
  await db.update(emailCampaigns).set(data).where(eq(emailCampaigns.id, id));
}

export async function finishEmailCampaign(
  id: string,
  data: {
    status: "done" | "error";
    error?: string;
    sentCount?: number;
    openedCount?: number;
    clickedCount?: number;
    unsubscribedCount?: number;
  },
): Promise<void> {
  if (!db) return;
  await db
    .update(emailCampaigns)
    .set({ ...data, finishedAt: new Date() })
    .where(eq(emailCampaigns.id, id));
}

export async function insertEmailCampaignRecipients(
  rows: NewEmailCampaignRecipient[],
): Promise<void> {
  if (!db || rows.length === 0) return;
  await db.insert(emailCampaignRecipients).values(rows);
}

export async function updateEmailCampaignRecipient(
  id: string,
  data: { status: "imported" | "sent" | "error"; error: string | null },
): Promise<void> {
  if (!db) return;
  await db
    .update(emailCampaignRecipients)
    .set(data)
    .where(eq(emailCampaignRecipients.id, id));
}

export async function listEmailCampaigns(limit = 30): Promise<EmailCampaign[]> {
  if (!db) return [];
  return db
    .select()
    .from(emailCampaigns)
    .orderBy(desc(emailCampaigns.startedAt))
    .limit(limit);
}

/** Кампании в процессе отправки — опрашиваются фоновой задачей раз в 5 минут. */
export async function listRunningEmailCampaigns(): Promise<EmailCampaign[]> {
  if (!db) return [];
  return db
    .select()
    .from(emailCampaigns)
    .where(
      and(
        eq(emailCampaigns.status, "running"),
        isNotNull(emailCampaigns.unisenderCampaignId),
      ),
    );
}

/** Последняя кампания по стадии — для предупреждения о возможном дубле. */
export async function getLastEmailCampaignForStage(
  stageId: string,
): Promise<EmailCampaign | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.stageId, stageId))
    .orderBy(desc(emailCampaigns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Есть ли по шаблону незавершённая рассылка — используется, чтобы не дать удалить шаблон посреди отправки. */
export async function hasActiveEmailCampaignForTemplate(
  templateId: string,
): Promise<boolean> {
  if (!db) return false;
  const rows = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(
      and(
        eq(emailCampaigns.templateId, templateId),
        inArray(emailCampaigns.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function getEmailCampaign(
  id: string,
): Promise<EmailCampaign | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listEmailCampaignRecipients(
  campaignId: string,
): Promise<EmailCampaignRecipientRow[]> {
  if (!db) return [];
  return db
    .select()
    .from(emailCampaignRecipients)
    .where(eq(emailCampaignRecipients.campaignId, campaignId))
    .orderBy(emailCampaignRecipients.contactName);
}
