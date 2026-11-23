import { timingSafeEqual } from "node:crypto";
import { env } from "@psi-opora/config";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { Layout } from "./layout";

/**
 * Вход в экраны — по тому же токену, что и админ-API (PAYMENTS_ADMIN_TOKEN):
 * вводится один раз в форме, дальше httpOnly-cookie SameSite=Strict (она же
 * защищает POST-формы от CSRF). Отдельной системы пользователей нет —
 * сервис внутренний.
 */

const COOKIE = "payments_session";

function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

export const requireLogin: MiddlewareHandler = async (c, next) => {
	const token = env.PAYMENTS_ADMIN_TOKEN;
	if (!token) return c.text("PAYMENTS_ADMIN_TOKEN не задан", 500);
	const session = getCookie(c, COOKIE);
	if (!session || !safeEqual(session, token)) return c.redirect("/ui/login");
	await next();
};

export const authRoutes = new Hono();

authRoutes.get("/login", (c) =>
	c.html(
		<Layout title="Вход" bare>
			<form method="post" action="/ui/login" class="card login">
				<h1>Оплаты</h1>
				{c.req.query("error") && (
					<div class="notice">Неверный токен доступа</div>
				)}
				<label>
					Токен доступа
					<input type="password" name="token" autofocus required />
				</label>
				<p>
					<button type="submit">Войти</button>
				</p>
			</form>
		</Layout>,
	),
);

authRoutes.post("/login", async (c) => {
	const expected = env.PAYMENTS_ADMIN_TOKEN;
	const body = await c.req.parseBody();
	const given = typeof body.token === "string" ? body.token : "";
	if (!expected || !safeEqual(given, expected)) {
		return c.redirect("/ui/login?error=1");
	}
	setCookie(c, COOKIE, expected, {
		httpOnly: true,
		sameSite: "Strict",
		secure: c.req.url.startsWith("https://"),
		path: "/",
		maxAge: 60 * 60 * 24 * 14,
	});
	return c.redirect("/ui");
});

authRoutes.post("/logout", (c) => {
	deleteCookie(c, COOKIE, { path: "/" });
	return c.redirect("/ui/login");
});
