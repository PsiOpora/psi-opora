import { callMaxLoginWorker, encryptSecret } from "@psi-opora/max-userbot";
import { publicProcedure } from "../../orpc";
import { submitMaxPasswordSchema } from "../../schemas/max-personal";
import {
	deletePendingMaxLogin,
	finalizeMaxLogin,
	getPendingMaxLogin,
	maskPhone,
} from "./helpers";

export const submitPassword = publicProcedure
	.input(submitMaxPasswordSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{
			status?: "connected";
			activationError?: string;
			error?: string;
		}> => {
			const pending = await getPendingMaxLogin(input.loginId);
			if (!pending || pending.memberId !== context.memberId) {
				console.error(
					`[max-personal-login] submitPassword: истёкшая или чужая сессия логина ${input.loginId} (memberId=${context.memberId})`,
				);
				return { error: "Сессия логина истекла — начните заново" };
			}
			console.log(
				`[max-personal-login] submitPassword: loginId=${input.loginId} memberId=${pending.memberId} phone=${maskPhone(pending.phone)}`,
			);
			try {
				// Пароль идёт воркеру через Redis — только в зашифрованном виде.
				const result = await callMaxLoginWorker(input.loginId, {
					action: "password",
					passwordEncrypted: encryptSecret(input.password),
				});
				if (result.status !== "connected") {
					throw new Error(`Неожиданный ответ воркера MAX: ${result.status}`);
				}
				const { activationError } = await finalizeMaxLogin({
					...pending,
					sessionEncrypted: result.sessionEncrypted,
					getBitrixApi: context.getBitrixApi,
				});
				await deletePendingMaxLogin(input.loginId);
				console.log(
					`[max-personal-login] submitPassword ok: loginId=${input.loginId} phone=${maskPhone(pending.phone)}${activationError ? ` (activationError: ${activationError})` : ""}`,
				);
				return { status: "connected", activationError };
			} catch (error) {
				console.error(
					`[max-personal-login] submitPassword failed: loginId=${input.loginId} phone=${maskPhone(pending.phone)}: ${(error as Error).stack ?? (error as Error).message}`,
				);
				return { error: (error as Error).message };
			}
		},
	);
