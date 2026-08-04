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
		if (!api) return { activationError: "Нет подключения к Битрикс24" };
		await api.call("imconnector.activate", {
			CONNECTOR: params.connectorId,
			LINE: Number(params.lineId),
			ACTIVE: "Y",
		});
		return {};
	} catch (error) {
		return { activationError: (error as Error).message };
	}
}
