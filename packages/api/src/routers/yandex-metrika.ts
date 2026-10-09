import {
	createYandexMetrikaStageGoal,
	deleteYandexMetrikaStageGoal,
	getYandexMetrikaSettings,
	listYandexMetrikaStageGoals,
	updateYandexMetrikaStageGoal,
	upsertYandexMetrikaSettings,
} from "@psi-opora/db/queries";
import { publicProcedure, router } from "../orpc";
import {
	updateYandexMetrikaStageGoalSchema,
	yandexMetrikaSettingsSchema,
	yandexMetrikaStageGoalIdSchema,
	yandexMetrikaStageGoalSchema,
} from "../schemas/yandex-metrika";

/** CATEGORY_ID из STAGE_ID: "C5:NEW" → "5", "NEW" (основная воронка) → "0". */
function categoryOfStage(stageId: string): string {
	return stageId.match(/^C(\d+):/)?.[1] ?? "0";
}

/** Postgres: unique_violation — см. unique (stage_id, goal_id) в yandex_metrika_stage_goals. */
function isDuplicateStageGoalError(err: unknown): boolean {
	return (err as { code?: string } | null)?.code === "23505";
}

/** Преобразует проверенные данные цели в поля БД, вычисляя воронку по ID стадии. */
function toStageGoalRow(
	input: ReturnType<typeof yandexMetrikaStageGoalSchema.parse>,
) {
	return {
		name: input.name,
		goalId: input.goalId,
		categoryId: categoryOfStage(input.stageId),
		stageId: input.stageId,
		enabled: input.enabled,
	};
}

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

	/** Цели, привязанные к стадиям воронки, с числом отправленных конверсий. */
	listStageGoals: publicProcedure.handler(async () => {
		return listYandexMetrikaStageGoals();
	}),

	createStageGoal: publicProcedure
		.input(yandexMetrikaStageGoalSchema)
		.handler(async ({ input }) => {
			try {
				await createYandexMetrikaStageGoal(
					crypto.randomUUID(),
					toStageGoalRow(input),
				);
			} catch (err) {
				if (isDuplicateStageGoalError(err)) {
					throw new Error(
						`Цель «${input.goalId}» уже привязана к этой стадии`,
					);
				}
				throw err;
			}
			return { ok: true };
		}),

	updateStageGoal: publicProcedure
		.input(updateYandexMetrikaStageGoalSchema)
		.handler(async ({ input }) => {
			try {
				await updateYandexMetrikaStageGoal(input.id, toStageGoalRow(input));
			} catch (err) {
				if (isDuplicateStageGoalError(err)) {
					throw new Error(
						`Цель «${input.goalId}» уже привязана к этой стадии`,
					);
				}
				throw err;
			}
			return { ok: true };
		}),

	removeStageGoal: publicProcedure
		.input(yandexMetrikaStageGoalIdSchema)
		.handler(async ({ input }) => {
			await deleteYandexMetrikaStageGoal(input.id);
			return { ok: true };
		}),
});
