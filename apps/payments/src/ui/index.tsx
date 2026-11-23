import { Hono } from "hono";
import { authRoutes, requireLogin } from "./auth";
import { catalogPages } from "./pages-catalog";
import { clientPages } from "./pages-clients";
import { paymentPages } from "./pages-payments";

/** Экраны учёта оплат — под /ui, вход по токену (см. auth.tsx). */
export const ui = new Hono();

ui.route("/", authRoutes);
ui.use("*", async (c, next) => {
	// Страница входа и выход доступны без сессии.
	const path = new URL(c.req.url).pathname;
	if (path === "/ui/login" || path === "/ui/logout") return next();
	return requireLogin(c, next);
});
ui.route("/", paymentPages);
ui.route("/", clientPages);
ui.route("/", catalogPages);
