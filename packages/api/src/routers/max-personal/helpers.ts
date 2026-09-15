import type { BitrixApi } from "@psi-opora/bitrix-client";
import { createRedisClient } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { upsertMaxPersonalAccountConnected } from "@psi-opora/db/queries";
import { encryptSecret } from "@psi-opora/max-userbot";

export interface PendingMaxPersonalLogin {
	memberId: string;
	lineId: string;
	connectorId: string;
	phone: string;
	pendingSession: string;
}

const PENDING_LOGIN_TTL_SECONDS = 10 * 60;
const pendingLoginKey = (loginId: string) =>
	`max-userbot:pending-login:${loginId}`;

/** Прячет середину номера в логах — оставляет код страны и последние 4 цифры. */
export function maskPhone(phone: string): string {
	if (phone.length <= 6) return phone;
	return `${phone.slice(0, 2)}***${phone.slice(-4)}`;
}

export async function savePendingMaxLogin(
	loginId: string,
	data: PendingMaxPersonalLogin,
): Promise<void> {
	await createRedisClient().set(pendingLoginKey(loginId), data, {
		ex: PENDING_LOGIN_TTL_SECONDS,
	});
}

export async function getPendingMaxLogin(
	loginId: string,
): Promise<PendingMaxPersonalLogin | null> {
	return (
		(await createRedisClient().get<PendingMaxPersonalLogin>(
			pendingLoginKey(loginId),
		)) ?? null
	);
}

export async function deletePendingMaxLogin(loginId: string): Promise<void> {
	await createRedisClient().del(pendingLoginKey(loginId));
}

export function generateMaxConnectorId(): string {
	return `${env.MAX_USERBOT_CONNECTOR_ID}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function finalizeMaxLogin(params: {
	memberId: string;
	lineId: string;
	connectorId: string;
	phone: string;
	session: string;
	getBitrixApi: () => Promise<BitrixApi | null>;
}): Promise<{ activationError?: string }> {
	await upsertMaxPersonalAccountConnected({
		memberId: params.memberId,
		openLineId: params.lineId,
		connectorId: params.connectorId,
		phone: params.phone,
		sessionEncrypted: encryptSecret(params.session),
	});
	try {
		const api = await params.getBitrixApi();
		if (!api) {
			console.error(
				`[max-personal-login] finalizeMaxLogin: memberId=${params.memberId} line=${params.lineId} — нет подключения к Битрикс24`,
			);
			return { activationError: "Нет подключения к Битрикс24" };
		}
		await api.call("imconnector.activate", {
			CONNECTOR: params.connectorId,
			LINE: Number(params.lineId),
			ACTIVE: "Y",
		});
		console.log(
			`[max-personal-login] finalizeMaxLogin ok: memberId=${params.memberId} line=${params.lineId} connector=${params.connectorId} phone=${maskPhone(params.phone)}`,
		);
		return {};
	} catch (error) {
		console.error(
			`[max-personal-login] finalizeMaxLogin activation failed: memberId=${params.memberId} line=${params.lineId} connector=${params.connectorId}: ${(error as Error).stack ?? (error as Error).message}`,
		);
		return { activationError: (error as Error).message };
	}
}
