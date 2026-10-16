import { bitrixProcedure, router } from "../orpc";
import {
	emailProviderSchema,
	rusenderSettingsSchema,
} from "../schemas/rusender";
import { unisenderSettingsSchema } from "../schemas/unisender";
import { smtpBzSettingsSchema } from "../schemas/smtp-bz";
import { resendSettingsSchema } from "../schemas/resend";
import {
	getEmailProvider,
	getResendSettings,
	getRusenderSettings,
	getSmtpBzSettings,
	getUnisenderSettings,
	setEmailProvider,
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

export const emailRouter = router({
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
		return maskApiKey(await getRusenderSettings());
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
