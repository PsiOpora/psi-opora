import {
	wahaGetQrCode,
	wahaGetSession,
	wahaSessionPhoneMatches,
	waSessionName,
} from "@psi-opora/waha";
import { publicProcedure } from "../../orpc";
import { pollWhatsappStatusSchema } from "../../schemas/whatsapp-personal";
import { finalizeConnectedLogin } from "./helpers";

/**
 * Виджет опрашивает статус WAHA-сессии, пока администратор вводит pairing
 * code на телефоне. Как только сессия дошла до WORKING — сохраняем аккаунт
 * и активируем коннектор на линии (см. finalizeConnectedLogin). Повторные
 * вызовы после подключения безвредны: upsert идемпотентен.
 */
export const pollStatus = publicProcedure
	.input(pollWhatsappStatusSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{
			status: "pending" | "connected" | "failed";
			error?: string;
			activationError?: string;
			qr?: { mimetype: string; data: string };
		}> => {
			const memberId = context.memberId;
			if (!memberId) {
				return {
					status: "failed",
					error: "Нет активной сессии Битрикс24 — обновите страницу",
				};
			}

			const session = waSessionName(memberId, input.lineId, input.connectorId);
			try {
				const state = await wahaGetSession(session);
				if (!state) {
					return {
						status: "failed",
						error: "Сессия не найдена — начните заново",
					};
				}
				if (state.status === "FAILED" || state.status === "STOPPED") {
					return {
						status: "failed",
						error: `Сессия в статусе ${state.status} — начните заново`,
					};
				}
				if (state.status !== "WORKING") {
					// WAHA перегенерирует QR каждые ~20с (виден по логам циклом QR-рефов
					// до "QR refs attempts ended") — отдаём свежий на каждый опрос,
					// иначе виджет молча показывает уже недействительную картинку.
					const qr = await wahaGetQrCode(session);
					return { status: "pending", qr: qr ?? undefined };
				}
				if (!wahaSessionPhoneMatches(state, input.phone)) {
					return {
						status: "failed",
						error:
							"К WhatsApp привязан другой номер. Отключите его и повторите подключение с правильным номером",
					};
				}

				// Не фиксируем кратковременный WORKING как успешный логин: некоторые
				// отклонённые WhatsApp привязки переходят в device_removed через секунды.
				await new Promise((resolve) => setTimeout(resolve, 5_000));
				const stableState = await wahaGetSession(session);
				if (stableState?.status !== "WORKING") {
					return {
						status: "failed",
						error:
							"WhatsApp отозвал привязку устройства. Обновите WhatsApp на телефоне и подключите номер заново",
					};
				}
				if (!wahaSessionPhoneMatches(stableState, input.phone)) {
					return {
						status: "failed",
						error:
							"К WhatsApp привязан другой номер. Отключите его и повторите подключение с правильным номером",
					};
				}

				const { activationError } = await finalizeConnectedLogin({
					memberId,
					lineId: input.lineId,
					connectorId: input.connectorId,
					phone: input.phone,
					sessionName: session,
					getBitrixApi: context.getBitrixApi,
				});
				return { status: "connected", activationError };
			} catch (err) {
				return { status: "failed", error: (err as Error).message };
			}
		},
	);
