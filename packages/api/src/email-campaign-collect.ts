import type { BitrixApi } from "@psi-opora/bitrix-client";
import {
	getEmailSuppressions,
	listAllEmailListContacts,
} from "@psi-opora/db/queries";
import {
	type EmailRecipient,
	finalizeEmailRecipients,
} from "./email-recipients-finalize";
import { normalizeEmail } from "./schemas/email-lists";

export type { EmailRecipient } from "./email-recipients-finalize";

export interface EmailRecipientsReport {
	audience: "crm_stage" | "list";
	/** Сделок на стадии (CRM) или контактов в списке. */
	totalDeals: number;
	recipients: EmailRecipient[];
	skipped: number;
	dryRun: boolean;
}

/** Коды UF-полей сделки, которыми в CRM отмечают отписку от email-рассылок. */
const UNSUBSCRIBE_DEAL_FIELDS = [
	"UF_CRM_1779044788018", // «Отписалась»
	"UF_CRM_1779045178666", // «Отписалась2»
];

const NO_EMAIL_REASON = "у контакта нет email";
const UNSUBSCRIBED_REASON = "отмечен как отписавшийся в CRM";

interface RawDeal {
	ID: string;
	TITLE: string;
	CONTACT_ID: string | null;
	[ufCode: string]: unknown;
}

interface RawContactEmail {
	VALUE: string;
	VALUE_TYPE: string;
}

interface RawContact {
	ID: string;
	NAME?: string;
	LAST_NAME?: string;
	EMAIL?: RawContactEmail[];
}

function isUnsubscribedDeal(deal: RawDeal): boolean {
	return UNSUBSCRIBE_DEAL_FIELDS.some((code) => {
		const value = deal[code];
		return value === true || value === "Y" || value === 1 || value === "1";
	});
}

/** Первый непустой email контакта, прошедший базовую проверку на "@". */
function findEmail(contact: RawContact): string | null {
	for (const entry of contact.EMAIL ?? []) {
		const value = entry.VALUE?.trim();
		if (value?.includes("@")) return value;
	}
	return null;
}

async function withSuppressions(
	recipients: EmailRecipient[],
): Promise<EmailRecipient[]> {
	const emails = recipients
		.filter((r) => r.status === "pending" && r.email)
		.map((r) => normalizeEmail(r.email as string));
	return finalizeEmailRecipients(
		recipients,
		await getEmailSuppressions(emails),
	);
}

/**
 * Собирает получателей email-рассылки по сделкам выбранной стадии: у каждой
 * сделки берётся привязанный контакт и его email (поле EMAIL, crm_multifield).
 * Контакт получает не больше одного письма, даже если сделок несколько.
 * Сделки/контакты, отмеченные полями «Отписалась»/«Отписалась2», и адреса из
 * стоп-листа исключаются.
 */
export async function collectEmailRecipients(
	api: BitrixApi,
	stageId: string,
): Promise<{ totalDeals: number; recipients: EmailRecipient[] }> {
	const deals = await api.list<RawDeal>("crm.deal.list", {
		select: ["ID", "TITLE", "CONTACT_ID", ...UNSUBSCRIBE_DEAL_FIELDS],
		filter: { STAGE_ID: stageId },
		order: { ID: "ASC" },
	});

	const unsubscribedContactIds = new Set(
		deals
			.filter((deal) => deal.CONTACT_ID && isUnsubscribedDeal(deal))
			.map((deal) => deal.CONTACT_ID as string),
	);

	const contactIds = [
		...new Set(deals.map((d) => d.CONTACT_ID).filter(Boolean)),
	] as string[];

	const contacts = contactIds.length
		? await api.list<RawContact>("crm.contact.list", {
				select: ["ID", "NAME", "LAST_NAME", "EMAIL"],
				filter: { "@ID": contactIds },
			})
		: [];
	const contactById = new Map(contacts.map((c) => [c.ID, c]));

	const recipients: EmailRecipient[] = [];
	const seenContacts = new Set<string>();

	for (const deal of deals) {
		if (!deal.CONTACT_ID || seenContacts.has(deal.CONTACT_ID)) continue;
		seenContacts.add(deal.CONTACT_ID);

		const contact = contactById.get(deal.CONTACT_ID);
		if (!contact) continue;

		const contactName =
			[contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") ||
			`Контакт #${contact.ID}`;
		const base = {
			key: contact.ID,
			contactId: contact.ID,
			contactName,
			dealId: deal.ID,
			dealTitle: deal.TITLE,
		};

		if (unsubscribedContactIds.has(deal.CONTACT_ID)) {
			recipients.push({
				...base,
				email: null,
				status: "skipped",
				error: UNSUBSCRIBED_REASON,
			});
			continue;
		}

		const email = findEmail(contact);
		recipients.push({
			...base,
			email,
			status: email ? "pending" : "skipped",
			...(email ? {} : { error: NO_EMAIL_REASON }),
		});
	}

	return {
		totalDeals: deals.length,
		recipients: await withSuppressions(recipients),
	};
}

/** Получатели рассылки по собственному списку контактов (/email-lists). */
export async function collectListRecipients(
	listId: string,
): Promise<{ totalDeals: number; recipients: EmailRecipient[] }> {
	const contacts = await listAllEmailListContacts(listId);
	const recipients: EmailRecipient[] = contacts.map((c) => ({
		key: c.id,
		contactId: null,
		contactName: c.name ?? "",
		dealId: null,
		dealTitle: null,
		email: c.email,
		status: "pending",
	}));
	return {
		totalDeals: contacts.length,
		recipients: await withSuppressions(recipients),
	};
}

export function buildEmailReport(
	audience: "crm_stage" | "list",
	totalDeals: number,
	recipients: EmailRecipient[],
	dryRun: boolean,
): EmailRecipientsReport {
	return {
		audience,
		totalDeals,
		recipients,
		skipped: recipients.filter((r) => r.status === "skipped").length,
		dryRun,
	};
}
