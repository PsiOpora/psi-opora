import {
	decodeStartParam,
	extractYmClientId,
} from "../packages/bot-core/src/utils/utm";
import pg from "../packages/db/node_modules/pg/lib/index.js";

/**
 * Заполняет yandex_metrika_messenger_visitors из истории `/start` в
 * bot_messages — для клиентов, которые открыли бота с ClientID/yclid до того,
 * как бот начал запоминать визит за пользователем. Берётся последний `/start`
 * с ClientID или yclid; более свежую запись, уже сделанную ботом, не трогает.
 *
 *   bun --env-file=.env run scripts/backfill-ym-messenger-visitors.ts          # пробный прогон
 *   bun --env-file=.env run scripts/backfill-ym-messenger-visitors.ts --apply  # запись в БД
 */

const { Pool } = pg;

interface StartRow {
	messenger: "telegram" | "max";
	user_id: string;
	payload: string;
	/** Как есть из `timestamp without time zone` — без пересчёта часового пояса. */
	created_at: string;
}

const APPLY = process.argv.includes("--apply");

async function main() {
	const connectionString = process.env.POSTGRES_URL;
	if (!connectionString) throw new Error("POSTGRES_URL не задан");

	const pool = new Pool({ connectionString });
	try {
		const { rows } = await pool.query<StartRow>(`
      SELECT
        messenger,
        user_id,
        regexp_replace(text, '^/start[[:space:]]+', '', 'i') AS payload,
        created_at::text AS created_at
      FROM bot_messages
      WHERE direction = 'in'
        AND messenger IN ('telegram', 'max')
        AND text ~* '^/start[[:space:]]+.*_y[mc][0-9]'
      ORDER BY bot_messages.created_at
    `);

		// Последний визит на пользователя: строки идут по возрастанию времени.
		const latest = new Map<
			string,
			{ row: StartRow; clientId?: string; yclid?: string }
		>();
		for (const row of rows) {
			const { ymClientId, yclid } = extractYmClientId(
				decodeStartParam(row.payload),
			);
			if (!ymClientId && !yclid) continue;
			latest.set(`${row.messenger}:${row.user_id}`, {
				row,
				clientId: ymClientId,
				yclid,
			});
		}

		console.log(
			`/start с ClientID/yclid: ${rows.length}, пользователей: ${latest.size}`,
		);
		let written = 0;
		for (const { row, clientId, yclid } of latest.values()) {
			console.log(
				`${row.messenger} ${row.user_id} ${row.created_at} clientId=${clientId ?? "-"} yclid=${yclid ?? "-"}`,
			);
			if (!APPLY) continue;
			const result = await pool.query(
				`
        INSERT INTO yandex_metrika_messenger_visitors
          (messenger, user_id, client_id, yclid, updated_at)
        VALUES ($1, $2, $3, $4, $5::timestamp)
        ON CONFLICT (messenger, user_id) DO UPDATE
          SET client_id = EXCLUDED.client_id,
              yclid = EXCLUDED.yclid,
              updated_at = EXCLUDED.updated_at
          WHERE yandex_metrika_messenger_visitors.updated_at < EXCLUDED.updated_at
      `,
				[
					row.messenger,
					row.user_id,
					clientId ?? null,
					yclid ?? null,
					row.created_at,
				],
			);
			written += result.rowCount ?? 0;
		}
		console.log(
			APPLY
				? `Записано/обновлено: ${written}`
				: "Пробный прогон — запустите с --apply, чтобы записать в БД.",
		);
	} finally {
		await pool.end();
	}
}

await main();
