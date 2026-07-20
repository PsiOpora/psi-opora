/**
 * Client-safe схемы: импортируются и сервером (input процедур), и браузером
 * (resolvers форм) через subpath `@psi-opora/api/schemas` — без затягивания
 * серверного кода (db, better-auth) в клиентский бандл.
 */
export { type AdCredentialsInput, adCredentialsSchema } from "./ads";
export {
  type BackupCredentialsInput,
  backupCredentialsSchema,
} from "./backup";
export {
  guideIdSchema,
  type SaveBotTextsInput,
  saveBotTextsSchema,
} from "./bot";
export { type AddCostInput, addCostSchema } from "./costs";
export {
  type UnisenderSettingsInput,
  unisenderSettingsSchema,
} from "./unisender";
