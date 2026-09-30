import { callMaxLoginWorker } from "@psi-opora/max-userbot";
import { publicProcedure } from "../../orpc";
import { submitMaxCodeSchema } from "../../schemas/max-personal";
import {
	deletePendingMaxLogin,
	finalizeMaxLogin,
	getPendingMaxLogin,
	maskPhone,
	savePendingMaxLogin,
} from "./helpers";

export const submitCode = publicProcedure.input(submitMaxCodeSchema).handler(
	async ({
		input,
		context,
	}): Promise<{
		status?: "connected" | "password_required";
		activationError?: string;
		/** Подсказка к облачному паролю и маскированная почта восстановления —
		 * только при status "password_required". */
		passwordHint?: string;
		passwordEmail?: string;
		error?: string;
	}> => {
		const pending = await getPendingMaxLogin(input.loginId);
		if (!pending || pending.memberId !== context.memberId) {
			console.error(
				`[max-personal-login] submitCode: истёкшая или чужая сессия логина ${input.loginId} (memberId=${context.memberId})`,
			);
			return { error: "Сессия логина истекла — начните заново" };
		}
		console.log(
			`[max-personal-login] submitCode: loginId=${input.loginId} memberId=${pending.memberId} phone=${maskPhone(pending.phone)}`,
		);
		try {
			const result = await callMaxLoginWorker(input.loginId, {
				action: "code",
				code: input.code,
			});
			if (result.status === "password_required") {
				// Продлеваем pending на время ввода пароля.
				await savePendingMaxLogin(input.loginId, pending);
				console.log(
					`[max-personal-login] submitCode: loginId=${input.loginId} phone=${maskPhone(pending.phone)} — нужен облачный пароль`,
				);
				return {
					status: "password_required",
					passwordHint: result.hint,
					passwordEmail: result.email,
				};
			}
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
				`[max-personal-login] submitCode ok: loginId=${input.loginId} phone=${maskPhone(pending.phone)}${activationError ? ` (activationError: ${activationError})` : ""}`,
			);
			return { status: "connected", activationError };
		} catch (error) {
			console.error(
				`[max-personal-login] submitCode failed: loginId=${input.loginId} phone=${maskPhone(pending.phone)}: ${(error as Error).stack ?? (error as Error).message}`,
			);
			return { error: (error as Error).message };
		}
	},
);
