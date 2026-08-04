import { confirmLoginCode } from "@psi-opora/max-userbot";
import { publicProcedure } from "../../orpc";
import { submitMaxCodeSchema } from "../../schemas/max-personal";
import {
	deletePendingMaxLogin,
	finalizeMaxLogin,
	getPendingMaxLogin,
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
			return { error: "Сессия логина истекла — начните заново" };
		}
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
			return { status: "connected", activationError };
		} catch (error) {
			return { error: (error as Error).message };
		}
	},
);
