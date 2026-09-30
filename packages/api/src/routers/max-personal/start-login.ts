import { callMaxLoginWorker } from "@psi-opora/max-userbot";
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
				// Соединение входа держит воркер (см. login-broker.ts): код
				// привязан к соединению, на котором запрошен.
				const loginId = crypto.randomUUID();
				const result = await callMaxLoginWorker(loginId, {
					action: "start",
					phone: input.phone,
				});
				if (result.status !== "code_sent") {
					throw new Error(`Неожиданный ответ воркера MAX: ${result.status}`);
				}
				await savePendingMaxLogin(loginId, {
					memberId: context.memberId,
					lineId: input.lineId,
					connectorId: input.connectorId,
					phone: result.phone,
				});
				console.log(
					`[max-personal-login] startLogin ok: loginId=${loginId} phone=${maskPhone(result.phone)} codeLength=${result.codeLength}`,
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
