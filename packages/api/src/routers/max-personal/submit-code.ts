import { confirmLoginCode } from "@psi-opora/max-userbot";
import { publicProcedure } from "../../orpc";
import { submitMaxCodeSchema } from "../../schemas/max-personal";
import {
	deletePendingMaxLogin,
	finalizeMaxLogin,
	getPendingMaxLogin,
	maskPhone,
} from "./helpers";

export const submitCode = publicProcedure.input(submitMaxCodeSchema).handler(
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
				`[max-personal-login] submitCode: истёкшая или чужая сессия логина ${input.loginId} (memberId=${context.memberId})`,
			);
			return { error: "Сессия логина истекла — начните заново" };
		}
		console.log(
			`[max-personal-login] submitCode: loginId=${input.loginId} memberId=${pending.memberId} phone=${maskPhone(pending.phone)}`,
		);
		try {
			const result = await confirmLoginCode({
				pendingSession: pending.pendingSession,
				code: input.code,
			});
			const { activationError } = await finalizeMaxLogin({
				...pending,
				session: result.session,
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
