import { getHatchetClient } from "./client";
import { deliverEmailCampaign } from "./email-campaign";

/**
 * Email-фаза: всех email_pending отдаём одной email-кампанией (шаблон и
 * тема — из настроек рассылки). Получатель рассылки связывается со строкой
 * email-кампании — по ней в отчёте виден статус письма (доставлено, открыто,
 * отписался), а ссылка отписки в письме работает как в обычной рассылке.
 * Вызывается при завершении, отмене и падении рассылки; без email-шаблона
 * (email выключен) ничего не делает.
 */
export async function startEmailFallback(campaignId: string): Promise<number> {
	const {
		createEmailCampaign,
		finishEmailCampaign,
		getOutreachCampaign,
		insertEmailCampaignRecipients,
		listOutreachRecipientsByStatus,
		revertOutreachEmailHandoff,
		setOutreachEmailCampaign,
		updateOutreachRecipient,
	} = await import("@psi-opora/db/queries");

	const campaign = await getOutreachCampaign(campaignId);
	if (!campaign?.emailTemplateId || !campaign.emailSubject) return 0;
	if (!campaign.emailSenderEmail || !campaign.emailProvider) {
		throw new Error("Не задан отправитель писем — проверьте /settings/email");
	}

	const pending: Array<{
		outreachId: string;
		name: string | null;
		email: string;
	}> = [];
	for (const r of await listOutreachRecipientsByStatus(
		campaignId,
		"email_pending",
		100_000,
	)) {
		if (r.email)
			pending.push({ outreachId: r.id, name: r.name, email: r.email });
	}
	if (pending.length === 0) return 0;

	const emailCampaignId = crypto.randomUUID();
	await createEmailCampaign({
		id: emailCampaignId,
		audience: "list",
		listId: campaign.listId,
		listName: campaign.listName
			? `${campaign.listName} (не дошло в мессенджеры)`
			: "Рассылка по списку: не дошло в мессенджеры",
		templateId: campaign.emailTemplateId,
		templateName: campaign.emailTemplateName ?? undefined,
		subject: campaign.emailSubject,
		senderEmail: campaign.emailSenderEmail,
		senderName: campaign.emailSenderName ?? undefined,
		provider:
			campaign.emailProvider === "unisender" ||
			campaign.emailProvider === "postbox"
				? campaign.emailProvider
				: "rusender",
		publicBaseUrl: campaign.publicBaseUrl,
		totalDeals: pending.length,
		recipientsCount: pending.length,
	});

	const rows = pending.map((p) => ({
		...p,
		emailRecipientId: crypto.randomUUID(),
	}));
	await insertEmailCampaignRecipients(
		rows.map((r) => ({
			id: r.emailRecipientId,
			campaignId: emailCampaignId,
			contactName: r.name,
			email: r.email,
			status: "pending",
		})),
	);
	for (const r of rows) {
		await updateOutreachRecipient(r.outreachId, {
			status: "email",
			channel: "email",
			emailRecipientId: r.emailRecipientId,
			sentAt: new Date(),
		});
	}

	try {
		await getHatchetClient().runNoWait(deliverEmailCampaign, {
			campaignId: emailCampaignId,
		});
	} catch (err) {
		const error = `Не удалось запустить отправку писем: ${(err as Error).message}`;
		await finishEmailCampaign(emailCampaignId, { status: "error", error });
		// Письма не ушли — получатели снова ждут email, а не числятся отправленными.
		await revertOutreachEmailHandoff(campaignId, emailCampaignId, error);
		throw err;
	}
	await setOutreachEmailCampaign(campaignId, emailCampaignId);
	return rows.length;
}
