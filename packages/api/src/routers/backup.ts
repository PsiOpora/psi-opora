import { env } from "@psi-opora/config";
import {
	createBackupRun,
	finishBackupRun,
	getBackupCredentials,
	listBackupRuns,
	upsertBackupCredentials,
} from "@psi-opora/db/queries";
import { enqueueCrmBackup, executeCrmBackup } from "@psi-opora/jobs";
import { publicProcedure, router } from "../orpc";
import { backupCredentialsSchema } from "../schemas/backup";

export interface RunBackupResult {
	ok: boolean;
	runId: string;
	error?: string;
}

export const backupRouter = router({
	getCredentials: publicProcedure.handler(async () => {
		return getBackupCredentials();
	}),

	upsertCredentials: publicProcedure
		.input(backupCredentialsSchema)
		.handler(async ({ input }) => {
			await upsertBackupCredentials(input);
			return { ok: true };
		}),

	listRuns: publicProcedure.handler(async () => {
		return listBackupRuns();
	}),

	runNow: publicProcedure.handler(
		async ({ context }): Promise<RunBackupResult> => {
			const runId = crypto.randomUUID();
			await createBackupRun(runId);

			let result: RunBackupResult = { ok: true, runId };

			if (env.HATCHET_CLIENT_TOKEN) {
				try {
					await enqueueCrmBackup({
						memberId: context.memberId ?? undefined,
						runId,
					});
				} catch (err) {
					const error = `Не удалось запустить фоновое задание: ${(err as Error).message}`;
					await finishBackupRun(runId, { status: "error", error });
					result = { ok: false, runId, error };
				}
			} else {
				try {
					const api = await context.getBitrixApi();
					if (!api) throw new Error("Bitrix24 не подключён");
					await executeCrmBackup(api, runId);
				} catch (err) {
					result = { ok: false, runId, error: (err as Error).message };
				}
			}

			return result;
		},
	),
});
