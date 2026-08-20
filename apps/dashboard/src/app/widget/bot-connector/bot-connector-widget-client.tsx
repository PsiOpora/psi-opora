"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orpcClient } from "@/lib/orpc/client";

type Messenger = "telegram" | "max";
type Status = "activating" | "done" | "error" | "needsToken";

/**
 * Активация канала бота на линии — при монтировании сразу вызываем activate
 * (привязка линии + автонастройка вебхука). Если токен бота ещё не сохранён
 * в БД и не задан в .env, сервер просит его ввести (см. tokenRequired) — тогда
 * показываем поле для токена. Кнопка «Повторить» — на случай прочих сбоев.
 */
export function BotConnectorWidgetClient({
	messenger,
	lineId,
}: {
	messenger: Messenger;
	lineId: string;
}) {
	const [status, setStatus] = useState<Status>("activating");
	const [error, setError] = useState<string | null>(null);
	const [webhookError, setWebhookError] = useState<string | null>(null);
	const [botToken, setBotToken] = useState("");
	const [busy, startTransition] = useTransition();

	const activate = (token?: string) => {
		if (!lineId) return;
		setStatus("activating");
		setError(null);
		startTransition(async () => {
			try {
				const res = await orpcClient.botConnector.activate({
					messenger,
					lineId,
					...(token ? { botToken: token } : {}),
				});
				if (res.tokenRequired) {
					setStatus("needsToken");
					return;
				}
				if (res.error) {
					setError(res.error);
					setStatus("error");
					return;
				}
				setWebhookError(res.webhookError ?? null);
				setStatus("done");
			} catch (err) {
				setError((err as Error).message);
				setStatus("error");
			}
		});
	};

	const submitToken = (e: FormEvent) => {
		e.preventDefault();
		if (!botToken.trim()) return;
		activate(botToken.trim());
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: активируем один раз при монтировании
	useEffect(() => {
		activate(undefined);
	}, []);

	if (!lineId) {
		return (
			<p className="text-xs text-destructive">
				Откройте это окно из настроек канала на линии в Контакт-центре — не
				удалось определить линию.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			{status === "activating" && (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Loader2Icon className="size-3.5 animate-spin" />
					Активируем линию…
				</p>
			)}

			{status === "done" && (
				<>
					<p className="flex items-center gap-1.5 text-sm text-emerald-600">
						<CheckIcon className="size-4" />
						Линия активирована
					</p>
					{webhookError && (
						<p className="text-xs text-destructive">
							Вебхук бота не настроен: {webhookError}. Линия всё равно активна —
							можно повторить ниже.
						</p>
					)}
				</>
			)}

			{status === "error" && error && (
				<p className="text-xs text-destructive">{error}</p>
			)}

			{status === "needsToken" && (
				<form onSubmit={submitToken} className="flex flex-col gap-1.5">
					<p className="text-xs text-muted-foreground">
						Укажите токен бота (выдаёт @BotFather для Telegram или платформа
						MAX) — он сохранится зашифрованным и понадобится только один раз.
					</p>
					<Input
						type="password"
						autoComplete="off"
						placeholder="Токен бота"
						value={botToken}
						onChange={(e) => setBotToken(e.target.value)}
					/>
					<Button size="sm" type="submit" disabled={busy || !botToken.trim()}>
						{busy && <Loader2Icon className="size-3.5 animate-spin" />}
						Сохранить и активировать
					</Button>
				</form>
			)}

			{(status === "error" || webhookError) && (
				<Button size="sm" onClick={() => activate()} disabled={busy}>
					{busy && <Loader2Icon className="size-3.5 animate-spin" />}
					Повторить
				</Button>
			)}
		</div>
	);
}
