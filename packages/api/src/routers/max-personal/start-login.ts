import { sendLoginCode } from "@psi-opora/max-userbot";
import { publicProcedure } from "../../orpc";
import { startMaxLoginSchema } from "../../schemas/max-personal";
import { savePendingMaxLogin } from "./helpers";

export const startLogin = publicProcedure
	.input(startMaxLoginSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{ loginId?: string; codeLength?: number; error?: string }> => {
			if (!context.memberId) {
				return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
			}
			try {
				const result = await sendLoginCode(input.phone);
				const loginId = crypto.randomUUID();
				await savePendingMaxLogin(loginId, {
					memberId: context.memberId,
					lineId: input.lineId,
					connectorId: input.connectorId,
					phone: input.phone,
					pendingSession: result.pendingSession,
				});
				return { loginId, codeLength: result.codeLength };
			} catch (error) {
				return { error: (error as Error).message };
			}
		},
	);
