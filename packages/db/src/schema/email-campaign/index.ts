import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const emailCampaigns = pgTable("email_campaigns", {
  id: text("id").primaryKey(),
  stageId: text("stage_id").notNull(),
  stageName: text("stage_name"),
  templateId: text("template_id").notNull(),
  templateName: text("template_name"),
  subject: text("subject").notNull(),
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name"),
  provider: text("provider").notNull().default("unisender"), // unisender | rusender
  status: text("status").notNull(), // queued | running | done | error
  unisenderListId: text("unisender_list_id"),
  unisenderMessageId: text("unisender_message_id"),
  unisenderCampaignId: text("unisender_campaign_id"),
  totalDeals: integer("total_deals"),
  recipientsCount: integer("recipients_count"),
  sentCount: integer("sent_count"),
  openedCount: integer("opened_count"),
  clickedCount: integer("clicked_count"),
  unsubscribedCount: integer("unsubscribed_count"),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export const emailCampaignRecipients = pgTable(
  "email_campaign_recipients",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull(),
    contactName: text("contact_name"),
    dealId: text("deal_id"),
    dealTitle: text("deal_title"),
    email: text("email"),
    status: text("status").notNull(), // pending | imported | skipped | error
    error: text("error"),
  },
  (table) => [
    index("email_campaign_recipients_campaign_idx").on(table.campaignId),
  ],
);
