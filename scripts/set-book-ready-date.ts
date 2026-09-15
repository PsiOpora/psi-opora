import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

/**
 * Выставляет дату готовности тиража книги «Тело берёт своё»
 * (bot_texts.book_ready_date) — с неё запускается цепочка напоминаний Б1–Б6
 * (packages/jobs/src/book-preorder-drip.ts). Пока не задана — рассылка не идёт.
 *
 * Запуск:
 *   bun --env-file=.env run scripts/set-book-ready-date.ts 2026-10-15
 */

const KEY = "book_ready_date";

async function main() {
	const raw = process.argv[2];
	if (!raw) {
		throw new Error(
			"Укажите дату (ISO, напр. 2026-10-15): bun run scripts/set-book-ready-date.ts 2026-10-15",
		);
	}
	const parsed = z.iso.date().safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`Ожидается календарная дата в формате YYYY-MM-DD, без времени и часового пояса: ${raw}`,
		);
	}
	const [year, month, day] = parsed.data.split("-").map(Number) as [
		number,
		number,
		number,
	];
	const date = new Date(Date.UTC(year, month - 1, day));

	const connectionString = process.env.POSTGRES_URL;
	if (!connectionString) throw new Error("POSTGRES_URL не задан");
	const pool = new Pool({ connectionString });

	try {
		await pool.query(
			`insert into bot_texts (key, value, updated_at)
			 values ($1, $2, now())
			 on conflict (key) do update set value = excluded.value, updated_at = now()`,
			[KEY, date.toISOString()],
		);
		console.log(`book_ready_date установлен: ${date.toISOString()}`);
	} finally {
		await pool.end();
	}
}

await main();
