import {
	getEmailCampaignRecipient,
	getEmailSuppressions,
	recordEmailEvents,
} from "@psi-opora/db/queries";

export const dynamic = "force-dynamic";

/**
 * Страница отписки из футера письма ({{unsubscribe_url}}). Токен — id
 * получателя рассылки (uuid, не угадывается). GET только показывает
 * подтверждение: почтовые сканеры ссылок открывают их автоматически и
 * не должны отписывать человека. Отписка — POST (кнопка на странице или
 * one-click по RFC 8058). Адрес попадает в глобальный стоп-лист.
 */

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** i***@mail.ru — ссылку могли переслать, полный адрес не показываем. */
function maskEmail(email: string): string {
	const [local = "", domain = ""] = email.split("@");
	return `${local.slice(0, 1)}***@${domain}`;
}

function page(title: string, body: string, status = 200): Response {
	const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, sans-serif; background: #f8f9fb; color: #1f2937; }
      .box { max-width: 28rem; padding: 2rem; text-align: center; background: #fff; border-radius: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,.08); }
      h1 { font-size: 1.2rem; margin: 0 0 .75rem; }
      p { margin: 0 0 1rem; color: #4b5563; font-size: .95rem; line-height: 1.5; }
      button { font: inherit; padding: .6rem 1.25rem; border: 0; border-radius: 8px; background: #111827;
        color: #fff; cursor: pointer; }
      button:hover { background: #374151; }
    </style>
  </head>
  <body><div class="box"><h1>${escapeHtml(title)}</h1>${body}</div></body>
</html>`;
	return new Response(html, {
		status,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
		},
	});
}

const notFound = () =>
	page(
		"Ссылка недействительна",
		"<p>Не удалось найти подписку по этой ссылке. Возможно, письмо было отправлено давно.</p>",
		404,
	);

async function loadRecipient(token: string) {
	if (!UUID_RE.test(token)) return null;
	const recipient = await getEmailCampaignRecipient(token);
	return recipient?.email ? { ...recipient, email: recipient.email } : null;
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ token: string }> },
): Promise<Response> {
	const { token } = await params;
	const recipient = await loadRecipient(token);
	if (!recipient) return notFound();

	const suppressions = await getEmailSuppressions([recipient.email]);
	if (suppressions.has(recipient.email.toLowerCase())) {
		return page(
			"Вы уже отписаны",
			`<p>Адрес ${escapeHtml(maskEmail(recipient.email))} больше не получает наши рассылки.</p>`,
		);
	}

	return page(
		"Отписаться от рассылки?",
		`<p>Адрес ${escapeHtml(maskEmail(recipient.email))} перестанет получать наши email-рассылки.</p>
<form method="post"><button type="submit">Отписаться</button></form>`,
	);
}

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ token: string }> },
): Promise<Response> {
	const { token } = await params;
	const recipient = await loadRecipient(token);
	if (!recipient) return notFound();

	await recordEmailEvents([
		{
			provider: "internal",
			// Повторное нажатие не задваивает событие в журнале.
			externalId: `unsubscribe:${recipient.id}`,
			type: "unsubscribed",
			occurredAt: new Date(),
			email: recipient.email,
			match: { recipientId: recipient.id },
		},
	]);

	return page(
		"Вы отписались",
		`<p>Адрес ${escapeHtml(maskEmail(recipient.email))} больше не будет получать наши рассылки.</p>`,
	);
}
