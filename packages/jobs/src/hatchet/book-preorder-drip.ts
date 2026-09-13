import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import { sendBookPreorderDrip } from "../book-preorder-drip";

/**
 * Напоминания о предзаказе книги «Тело берёт своё» (Б1–Б6) — раз в час
 * достаточно, дни считаются от bot_texts.book_ready_date (см.
 * sendBookPreorderDrip). Сдвиг от "0 * * * *", как у guide-follow-ups.
 */
export const bookPreorderDrip = CreateTaskWorkflow({
	name: "book-preorder-drip",
	on: { cron: "10 * * * *" },
	retries: 0,
	executionTimeout: "10m",
	fn: async () => ({ ...(await sendBookPreorderDrip()) }),
});
