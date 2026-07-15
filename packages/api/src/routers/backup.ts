import { publicProcedure, router } from "../orpc";
import { z } from "zod";
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
    .input(
      z.object({
        s3Endpoint: z.string().optional(),
        s3Region: z.string().optional(),
        s3Bucket: z.string().optional(),
        s3AccessKeyId: z.string().optional(),
        s3SecretAccessKey: z.string().optional(),
      }),
    )
    .handler(async ({ input }) => {
      await upsertBackupCredentials(input);
      return { ok: true };
    }),

  listRuns: publicProcedure.handler(async () => {
    return listBackupRuns();
  }),
});
