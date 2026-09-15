import { confirmLoginCode } from "@psi-opora/tg-userbot";
import { publicProcedure } from "../../orpc";
import { submitTelegramCodeSchema } from "../../schemas/telegram-personal";
import {
	deletePendingTelegramLogin,
	finalizeConnectedLogin,
	getPendingTelegramLogin,
	savePendingTelegramLogin,
} from "./helpers";

export const submitCode = publicProcedure
	.input(submitTelegramCodeSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{
			status?: "connected" | "password_required";
			error?: string;
			activationError?: string;
		}> => {
			const pending = await getPendingTelegramLogin(input.loginId);
			if (!pending || pending.memberId !== context.memberId) {
				return { error: "Сессия логина истекла — начните заново" };
			}

			try {
				const result = await confirmLoginCode(
					{
						pendingSession: pending.pendingSession,
						phone: pending.phone,
						phoneCodeHash: pending.phoneCodeHash,
						code: input.code,
					},
					{ apiId: pending.apiId, apiHash: pending.apiHash },
				);

				if (result.status === "password_required") {
					await savePendingTelegramLogin(input.loginId, {
						...pending,
						pendingSession: result.pendingSession,
						awaiting: "password",
					});
					return { status: "password_required" };
				}

				const { activationError } = await finalizeConnectedLogin({
					memberId: pending.memberId,
					lineId: pending.lineId,
					connectorId: pending.connectorId,
					phone: pending.phone,
					apiId: pending.apiId,
					apiHash: pending.apiHash,
					session: result.session,
					getBitrixApi: context.getBitrixApi,
				});
				await deletePendingTelegramLogin(input.loginId);
				return { status: "connected", activationError };
			} catch (err) {
				return { error: (err as Error).message };
			}
		},
	);
