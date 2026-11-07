import type {
	UploadedAttachment,
	WidgetChannel,
	WidgetEntity,
	WidgetHistoryItem,
} from "@psi-opora/api";
import { MAX_ATTACHMENT_SIZE } from "@psi-opora/api/schemas";

/** Битрикс24 не сообщает приложению высоту области вкладки, а iframe
 * CRM_DEAL_DETAIL_TAB по умолчанию — узкая форма. Поэтому просим высоту «на всё
 * окно»: высота экрана за вычетом шапки портала, заголовка карточки, вкладок и
 * панели браузера. Ширину не трогаем — её уже выделил Битрикс. */
const WIDGET_MIN_HEIGHT_PX = 600;
const WIDGET_MAX_HEIGHT_PX = 1400;
const PORTAL_CHROME_HEIGHT_PX = 320;

export function computeWidgetHeight(): number {
	const available = window.screen.availHeight - PORTAL_CHROME_HEIGHT_PX;
	return Math.min(
		WIDGET_MAX_HEIGHT_PX,
		Math.max(WIDGET_MIN_HEIGHT_PX, available),
	);
}

export function draftStorageKey(
	entity: WidgetEntity,
	entityId: string,
): string {
	return `psi-opora:widget-draft:${entity}:${entityId}`;
}

const SOUND_STORAGE_KEY = "psi-opora:widget-sound";

/** localStorage может быть недоступен в iframe виджета (Safari ITP и т.п.) —
 * тогда значение просто не сохраняется, без падения виджета. */
export function readStored(key: string): string {
	try {
		return localStorage.getItem(key) ?? "";
	} catch {
		return "";
	}
}

export function writeStored(key: string, value: string): void {
	try {
		if (value) localStorage.setItem(key, value);
		else localStorage.removeItem(key);
	} catch {
		// недоступно — не сохранится, остальное работает
	}
}

export function readSoundEnabled(): boolean {
	return readStored(SOUND_STORAGE_KEY) !== "off";
}

export function writeSoundEnabled(enabled: boolean): void {
	writeStored(SOUND_STORAGE_KEY, enabled ? "" : "off");
}

/** Короткий двойной «бип» о новом входящем — без аудиофайла. Браузер может не
 * разрешить звук до первого действия пользователя во фрейме — тогда молчим. */
export function playIncomingSound(): void {
	try {
		const Ctx =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!Ctx) return;
		const ctx = new Ctx();
		const now = ctx.currentTime;
		for (const [offset, freq] of [
			[0, 880],
			[0.14, 1175],
		] as const) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.0001, now + offset);
			gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
			osc.connect(gain).connect(ctx.destination);
			osc.start(now + offset);
			osc.stop(now + offset + 0.2);
		}
		setTimeout(() => void ctx.close(), 600);
	} catch {
		// звук — необязательное удобство
	}
}

export function channelKey(
	channel: Pick<WidgetChannel, "messenger" | "lineId" | "connectorId">,
): string {
	return `${channel.messenger}:${channel.lineId ?? ""}:${channel.connectorId ?? ""}`;
}

/** Канал, которым написано сообщение истории: точное совпадение
 * messenger+connectorId (различает несколько личных номеров одного
 * мессенджера), затем только по messenger. */
export function findChannelForMessage(
	channels: WidgetChannel[],
	item: Pick<WidgetHistoryItem, "messenger" | "connectorId">,
): WidgetChannel | null {
	return (
		channels.find(
			(c) =>
				c.messenger === item.messenger && c.connectorId === item.connectorId,
		) ??
		channels.find((c) => c.messenger === item.messenger) ??
		null
	);
}

/**
 * Канал по умолчанию — тот, через который уже идёт переписка с клиентом:
 * канал последнего сообщения истории (свежие — в конце, см.
 * WidgetRecipient.history). Если истории ещё нет (новый контакт) — первый
 * доступный канал.
 */
export function pickDefaultChannel(
	channels: WidgetChannel[],
	history: WidgetHistoryItem[],
): WidgetChannel | null {
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i];
		if (!item) continue;
		const match = findChannelForMessage(channels, item);
		if (match) return match;
	}
	return channels[0] ?? null;
}

/** Загрузка вложения в S3 до отправки сообщения (см. api/attachments). */
export async function uploadAttachment(
	file: File,
	signal?: AbortSignal,
): Promise<UploadedAttachment> {
	if (file.size === 0) throw new Error("Файл пустой");
	if (file.size > MAX_ATTACHMENT_SIZE) {
		throw new Error(
			`Файл больше ${Math.floor(MAX_ATTACHMENT_SIZE / (1024 * 1024))} МБ`,
		);
	}
	const form = new FormData();
	form.append("file", file);
	const res = await fetch("/api/attachments", {
		method: "POST",
		body: form,
		signal,
	});
	const data = (await res.json().catch(() => null)) as
		| (UploadedAttachment & { ok?: boolean; error?: string })
		| null;
	if (!res.ok || !data?.s3Key) {
		throw new Error(data?.error ?? "Не удалось загрузить файл");
	}
	return data;
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} Б`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
