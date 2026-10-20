import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { env } from "@psi-opora/config";
import { createUnisenderClient } from "@psi-opora/unisender-client";
import { bitrixProcedure, router } from "../orpc";
import {
	emailProviderSchema,
	rusenderSettingsSchema,
} from "../schemas/rusender";
import { unisenderSettingsSchema } from "../schemas/unisender";
import { smtpBzSettingsSchema } from "../schemas/smtp-bz";
import { postboxSettingsSchema } from "../schemas/postbox";
import { resendSettingsSchema } from "../schemas/resend";
import {
	getEmailProvider,
	getPostboxSettings,
	getResendSettings,
	getRusenderSettings,
	getSmtpBzSettings,
	getUnisenderSettings,
	setEmailProvider,
	setRusenderWebhookSecret,
	upsertPostboxSettings,
	upsertResendSettings,
	upsertRusenderSettings,
	upsertSmtpBzSettings,
	upsertUnisenderSettings,
} from "@psi-opora/db/queries";

/** Короче этого хвост ключа не показываем — он раскрыл бы заметную часть секрета. */
const MIN_MASKABLE_LENGTH = 12;

/**
 * Маска API-ключа для UI: «••••» + последние 4 символа (или только «••••»
 * для коротких ключей); `null` — ключ не задан. Сам ключ на клиент не уходит.
 */
export function maskSecret(value: string | null | undefined): string | null {
	if (!value) return null;
	return value.length < MIN_MASKABLE_LENGTH ? "••••" : `••••${value.slice(-4)}`;
}

/** Заменяет `apiKey` на `apiKeyMask` в настройках провайдера перед отдачей на клиент. */
function maskApiKey<T extends { apiKey: string | null }>(
	settings: T | null,
): (Omit<T, "apiKey"> & { apiKeyMask: string | null }) | null {
	if (!settings) return null;
	const { apiKey, ...rest } = settings;
	return { ...rest, apiKeyMask: maskSecret(apiKey) };
}

/** События Unisender, нужные для статистики по каждому получателю. */
const UNISENDER_HOOK_EVENTS = {
	email_status: "ok_sent,ok_delivered,ok_read,ok_link_visited,err_will_retry",
	unsubscribe: "*",
};

/**
 * Базовый адрес apps/bitrix-webhook — туда провайдеры шлют события доставки.
 * Берётся из того же NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL, что и вебхуки Bitrix24.
 */
function webhookAppOrigin(): string | null {
	const url = env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL;
	if (!url) return null;
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

function rusenderWebhookUrl(secret: string | null | undefined): string | null {
	const origin = webhookAppOrigin();
	return origin && secret
		? `${origin}/api/email-events/rusender/${secret}`
		: null;
}

function unisenderWebhookUrl(): string | null {
	const origin = webhookAppOrigin();
	return origin ? `${origin}/api/email-events/unisender` : null;
}

/** Вебхуки статусов писем: Rusender — URL с секретом, Unisender — setHook. */
const webhooksRouter = router({
	status: bitrixProcedure.handler(async () => {
		const [rusender, unisender] = await Promise.all([
			getRusenderSettings(),
			getUnisenderSettings(),
		]);
		const unisenderUrl = unisenderWebhookUrl();
		let unisenderConnected: boolean | null = null;
		let unisenderError: string | null = null;
		if (unisender?.apiKey && unisenderUrl) {
			try {
				const hooks = await createUnisenderClient(unisender.apiKey).listHooks();
				unisenderConnected = hooks.some(
					(h) => h.hook_url === unisenderUrl && h.status === "active",
				);
			} catch (err) {
				unisenderError = (err as Error).message;
			}
		}
		return {
			appUrlConfigured: webhookAppOrigin() !== null,
			rusenderUrl: rusenderWebhookUrl(rusender?.webhookSecret),
			unisenderUrl,
			unisenderConfigured: Boolean(unisender?.apiKey),
			unisenderConnected,
			unisenderError,
		};
	}),

	/** Создаёт (или перевыпускает) секрет URL вебхука Rusender. */
	rotateRusenderSecret: bitrixProcedure.handler(async () => {
		if (!webhookAppOrigin()) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL не задан",
			});
		}
		const secret = randomBytes(24).toString("base64url");
		await setRusenderWebhookSecret(secret);
		return { url: rusenderWebhookUrl(secret) };
	}),

	/** Подписывает apps/bitrix-webhook на события Unisender через setHook. */
	connectUnisender: bitrixProcedure.handler(async () => {
		const url = unisenderWebhookUrl();
		if (!url) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL не задан",
			});
		}
		const settings = await getUnisenderSettings();
		if (!settings?.apiKey) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "Сначала сохраните API-ключ Unisender",
			});
		}
		try {
			await createUnisenderClient(settings.apiKey).setHook({
				hookUrl: url,
				events: UNISENDER_HOOK_EVENTS,
			});
		} catch (err) {
			throw new ORPCError("BAD_GATEWAY", { message: (err as Error).message });
		}
		return { ok: true, url };
	}),
});

export const emailRouter = router({
	webhooks: webhooksRouter,

	getSettings: bitrixProcedure.handler(async () => {
		return maskApiKey(await getUnisenderSettings());
	}),

	upsertSettings: bitrixProcedure
		.input(unisenderSettingsSchema)
		.handler(async ({ input }) => {
			await upsertUnisenderSettings(input);
			return { ok: true };
		}),

	getRusenderSettings: bitrixProcedure.handler(async () => {
		const settings = await getRusenderSettings();
		if (!settings) return null;
		// Секрет вебхука наружу не отдаём: он — единственная защита вебхука.
		const { webhookSecret: _secret, ...rest } = settings;
		return maskApiKey(rest);
	}),

	upsertRusenderSettings: bitrixProcedure
		.input(rusenderSettingsSchema)
		.handler(async ({ input }) => {
			await upsertRusenderSettings(input);
			return { ok: true };
		}),

	getSmtpBzSettings: bitrixProcedure.handler(async () => {
		return maskApiKey(await getSmtpBzSettings());
	}),

	upsertSmtpBzSettings: bitrixProcedure
		.input(smtpBzSettingsSchema)
		.handler(async ({ input }) => {
			await upsertSmtpBzSettings(input);
			return { ok: true };
		}),

	getResendSettings: bitrixProcedure.handler(async () => {
		return maskApiKey(await getResendSettings());
	}),

	upsertResendSettings: bitrixProcedure
		.input(resendSettingsSchema)
		.handler(async ({ input }) => {
			await upsertResendSettings(input);
			return { ok: true };
		}),

	getPostboxSettings: bitrixProcedure.handler(async () => {
		return maskApiKey(await getPostboxSettings());
	}),

	upsertPostboxSettings: bitrixProcedure
		.input(postboxSettingsSchema)
		.handler(async ({ input }) => {
			await upsertPostboxSettings(input);
			return { ok: true };
		}),

	getProvider: bitrixProcedure.handler(async () => {
		return { provider: await getEmailProvider() };
	}),

	setProvider: bitrixProcedure
		.input(emailProviderSchema)
		.handler(async ({ input }) => {
			await setEmailProvider(input.provider);
			return { ok: true };
		}),
});
