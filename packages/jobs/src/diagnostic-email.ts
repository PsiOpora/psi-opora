import {
	getEmailProvider,
	getRusenderSettings,
	getUnisenderSettings,
} from "@psi-opora/db/queries";
import { createRusenderClient } from "@psi-opora/rusender-client";
import { createUnisenderClient } from "@psi-opora/unisender-client";

const DEFAULT_SENDER_NAME = 'Психологический центр "Опора"';

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function linkifyLine(line: string): string {
	const escaped = escapeHtml(line);
	return escaped.replace(
		/(https?:\/\/[^\s<]+)/g,
		'<a href="$1" style="color:#2f7664">$1</a>',
	);
}

export function diagnosticEmailHtml(text: string): string {
	const body = text
		.split(/\n{2,}/)
		.map(
			(paragraph) =>
				`<p style="margin:0 0 16px;line-height:1.55">${paragraph
					.split("\n")
					.map(linkifyLine)
					.join("<br>")}</p>`,
		)
		.join("");

	return [
		'<div style="font-family:Arial,sans-serif;color:#24332f;max-width:640px;margin:0 auto">',
		body,
		'<p style="margin:24px 0 0;color:#65736f;font-size:13px">Психологический центр «Опора»</p>',
		"</div>",
	].join("");
}

export async function sendDiagnosticEmail(params: {
	to: string;
	subject: string;
	text: string;
}): Promise<void> {
	const provider = await getEmailProvider();
	const body = diagnosticEmailHtml(params.text);

	if (provider === "unisender") {
		const settings = await getUnisenderSettings();
		if (!settings?.apiKey || !settings.senderEmail) {
			throw new Error("Unisender или адрес отправителя не настроен");
		}
		await createUnisenderClient(settings.apiKey).sendEmail({
			email: params.to,
			senderName: settings.senderName?.trim() || DEFAULT_SENDER_NAME,
			senderEmail: settings.senderEmail,
			subject: params.subject,
			body,
		});
		return;
	}

	const settings = await getRusenderSettings();
	if (!settings?.apiKey || !settings.keyId || !settings.senderEmail) {
		throw new Error("Rusender или адрес отправителя не настроен");
	}
	await createRusenderClient(settings.apiKey, settings.keyId).sendEmail({
		email: params.to,
		senderName: settings.senderName?.trim() || DEFAULT_SENDER_NAME,
		senderEmail: settings.senderEmail,
		subject: params.subject,
		body,
	});
}
