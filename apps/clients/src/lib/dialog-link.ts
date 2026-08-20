import type { InboxMessenger } from "@psi-opora/api";

const INBOX_MESSENGERS: readonly InboxMessenger[] = [
	"telegram",
	"max",
	"telegram-personal",
	"whatsapp-personal",
	"max-personal",
];

export interface DialogReference {
	messenger: InboxMessenger;
	userId: string;
}

function isInboxMessenger(value: string): value is InboxMessenger {
	return INBOX_MESSENGERS.some((messenger) => messenger === value);
}

/** Читает глубокую ссылку на диалог из query-параметров страницы. */
export function parseDialogReference(
	searchParams: URLSearchParams,
): DialogReference | null {
	const messenger = searchParams.get("messenger");
	const userId = searchParams.get("userId")?.trim();

	if (!messenger || !isInboxMessenger(messenger) || !userId) return null;
	return { messenger, userId };
}

/** Строит чистую ссылку без OAuth/query-параметров текущего фрейма Bitrix24. */
export function buildDialogLink(
	reference: DialogReference,
	location: Pick<Location, "origin" | "pathname">,
): string {
	const url = new URL(location.pathname, location.origin);
	url.searchParams.set("messenger", reference.messenger);
	url.searchParams.set("userId", reference.userId);
	return url.toString();
}

/** Clipboard API может быть запрещён внутри iframe — оставляем legacy fallback. */
export async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		return;
	} catch {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.readOnly = true;
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.append(textarea);
		textarea.select();
		const copied = document.execCommand("copy");
		textarea.remove();
		if (!copied) throw new Error("Clipboard is unavailable");
	}
}

/** Синхронизирует адрес открытого диалога, сохраняя параметры текущего фрейма. */
export function replaceDialogInCurrentUrl(reference: DialogReference): void {
	const url = new URL(window.location.href);
	url.searchParams.set("messenger", reference.messenger);
	url.searchParams.set("userId", reference.userId);
	window.history.replaceState(window.history.state, "", url);
}
