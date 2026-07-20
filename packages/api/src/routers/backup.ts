import { publicProcedure, router } from "../orpc";
import { backupCredentialsSchema } from "../schemas/backup";
import {
  getBackupCredentials,
  upsertBackupCredentials,
  listBackupRuns,
} from "@psi-opora/db/queries";

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
});
