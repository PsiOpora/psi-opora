import {
	getYandexMetrikaSettings,
	upsertYandexMetrikaSettings,
} from "@psi-opora/db/queries";
import { publicProcedure, router } from "../orpc";
import { yandexMetrikaSettingsSchema } from "../schemas/yandex-metrika";

export const yandexMetrikaRouter = router({
	getSettings: publicProcedure.handler(async () => {
		return getYandexMetrikaSettings();
	}),

	upsertSettings: publicProcedure
		.input(yandexMetrikaSettingsSchema)
		.handler(async ({ input }) => {
			await upsertYandexMetrikaSettings(input);
			return { ok: true };
		}),
});
