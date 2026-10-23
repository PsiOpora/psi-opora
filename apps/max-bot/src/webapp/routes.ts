import {
	CONSULT_START_KEYWORD,
	getScenarioTexts,
	isValidStartParam,
} from "@psi-opora/bot-core";
import { Hono } from "hono";
import { z } from "zod";
import { log, type MaxBot, processUpdate } from "../bot";
import { type VerifiedInitData, verifyMaxInitData } from "./init-data";
import { renderWebAppPage } from "./page";

const consultBodySchema = z.object({ initData: z.string().min(1).max(8192) });

/**
 * start-параметр для «Записаться»: CONSULT, а если мини-приложение открыли
 * по ссылке `?startapp=<метка>` — CONSULT_<метка>, чтобы источник рекламы
 * дошёл до сделки так же, как при обычном диплинке в бота.
 */
export function consultPayload(startParam: string | undefined): string {
	const withSource = startParam
		? `${CONSULT_START_KEYWORD}_${startParam}`
		: CONSULT_START_KEYWORD;
	return isValidStartParam(withSource) ? withSource : CONSULT_START_KEYWORD;
}

/**
 * Синтетический bot_started от имени пользователя мини-приложения. Ссылка
 * `max.ru/<бот>?start=` тут не годится: MAX шлёт bot_started только при
 * первом запуске бота (или после остановки), а мини-приложение открывают
 * как раз из уже начатого чата. Апдейт идёт через обычный конвейер бота
 * (лок пользователя, сессия, handleStart), без chat_id — ответы уходят по
 * user_id (см. replyWithFallback в ../bot.ts).
 */
function consultUpdate({ user, startParam }: VerifiedInitData) {
	const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
	return {
		update_type: "bot_started",
		timestamp: Date.now(),
		user: {
			user_id: user.id,
			name,
			first_name: user.first_name ?? "",
			last_name: user.last_name ?? undefined,
			username: user.username ?? null,
			is_bot: false,
			last_activity_time: Date.now(),
		},
		payload: consultPayload(startParam),
	};
}

export function createWebAppRoutes({
	bot,
	token,
}: {
	bot: MaxBot;
	token: string;
}): Hono {
	const app = new Hono();

	// Username нужен только для ссылки «в чат» вне MAX — один раз спрашиваем
	// у API; при ошибке не кэшируем, чтобы следующий запрос попробовал снова.
	let botUsername: Promise<string | null> | null = null;
	const resolveBotUsername = () => {
		botUsername ??= bot.api
			.getMyInfo()
			.then((info) => info.username?.replace(/^@/, "") || null)
			.catch((err: unknown) => {
				log(`[webapp] не удалось узнать username бота: ${String(err)}`);
				botUsername = null;
				return null;
			});
		return botUsername;
	};

	app.get("/", async (c) => {
		const [texts, username] = await Promise.all([
			getScenarioTexts(),
			resolveBotUsername(),
		]);
		c.header("Cache-Control", "no-store");
		return c.html(renderWebAppPage({ texts, botUsername: username }));
	});

	app.post("/webapp/consult", async (c) => {
		const body = consultBodySchema.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!body.success) return c.json({ error: "bad_request" }, 400);
		const verified = verifyMaxInitData(body.data.initData, token);
		if (!verified) return c.json({ error: "invalid_init_data" }, 401);

		log(
			`[webapp] запись на консультацию user=${verified.user.id}${verified.startParam ? ` start_param=${verified.startParam}` : ""}`,
		);
		await processUpdate(bot, consultUpdate(verified));
		return c.json({ ok: true });
	});

	return app;
}
