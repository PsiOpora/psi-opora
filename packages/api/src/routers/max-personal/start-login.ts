import { sendLoginCode } from "@psi-opora/max-userbot";
import { publicProcedure } from "../../orpc";
import { startMaxLoginSchema } from "../../schemas/max-personal";
import { maskPhone, savePendingMaxLogin } from "./helpers";

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
			console.log(
				`[max-personal-login] startLogin: memberId=${context.memberId} line=${input.lineId} connector=${input.connectorId} phone=${maskPhone(input.phone)}`,
			);
			try {
				const result = await sendLoginCode(input.phone);
				const loginId = crypto.randomUUID();
				await savePendingMaxLogin(loginId, {
					memberId: context.memberId,
					lineId: input.lineId,
					connectorId: input.connectorId,
					phone: result.phone,
					pendingSession: result.pendingSession,
				});
				console.log(
					`[max-personal-login] startLogin ok: loginId=${loginId} phone=${maskPhone(result.phone)} codeLength=${result.codeLength}}`,
				);
				return { loginId, codeLength: result.codeLength };
			} catch (error) {
				console.error(
					`[max-personal-login] startLogin failed: memberId=${context.memberId} phone=${maskPhone(input.phone)}: ${(error as Error).stack ?? (error as Error).message}`,
				);
				return { error: (error as Error).message };
			}
		},
	);
