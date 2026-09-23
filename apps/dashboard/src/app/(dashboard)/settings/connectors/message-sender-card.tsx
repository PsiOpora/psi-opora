"use client";

import { Text } from "@bitrix24/b24jssdk";
import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useB24Frame } from "@/components/bitrix/frame-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

// Коды должны совпадать с MESSAGE_SENDER_CODES в
// apps/bitrix-webhook/src/message-sender-payload.ts — по коду обработчик
// понимает, с какого личного номера отправлять.
const MESSAGE_SENDER_PROVIDERS = [
	{
		code: "psiopora_wa_personal",
		name: "WhatsApp (личный номер)",
		description:
			"Отправка в WhatsApp с подключённого личного номера. Ответ клиента придёт в Открытую линию.",
	},
	{
		code: "psiopora_tg_personal",
		name: "Telegram (личный номер)",
		description:
			"Отправка в Telegram с подключённого личного номера по телефону клиента. Ответ придёт в Открытую линию.",
	},
] as const;

const BITRIX_WEBHOOK_APP_URL = process.env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL;

/** NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL — полный путь до /api/bitrix-webhook;
 * провайдерам нужен соседний роут того же приложения. */
function senderHandlerUrl(): string | null {
	if (!BITRIX_WEBHOOK_APP_URL) return null;
	try {
		return `${new URL(BITRIX_WEBHOOK_APP_URL).origin}/api/message-sender`;
	} catch {
		return null;
	}
}

function explainError(messages: string[]): string {
	const text = messages.join("; ");
	if (/insufficient_scope|method not found/i.test(text)) {
		return `${text} — добавьте приложению право «messageservice» в настройках локального приложения Битрикс24 и переустановите его`;
	}
	return text;
}

/**
 * Регистрация личных номеров как провайдеров сообщений CRM
 * (messageservice.sender.add) — тогда они появляются в CRM → «Каналы для
 * отправки сообщений» и в «Написать клиенту»/роботах «Отправить SMS».
 * Это отдельный от Контакт-центра механизм: коннекторы Открытых линий
 * (карточки ниже) туда не попадают. Как и imconnector.*, методы работают
 * только в контексте приложения, поэтому вызываются из фрейма.
 */
export function MessageSenderCard() {
	const { b24, status } = useB24Frame();
	const [registered, setRegistered] = useState<string[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, startTransition] = useTransition();
	const handler = senderHandlerUrl();

	const refresh = useCallback(async () => {
		if (!b24) return;
		try {
			const res = await b24.actions.v2.call.make({
				method: "messageservice.sender.list",
				params: {},
				requestId: Text.getUuidRfc4122(),
			});
			if (!res.isSuccess) {
				// Без права messageservice список недоступен — кнопку всё равно
				// оставляем активной, чтобы ошибка регистрации подсказала решение.
				setRegistered([]);
				setError(explainError(res.getErrorMessages()));
				return;
			}
			const codes =
				(res.getData() as { result?: string[] } | undefined)?.result ?? [];
			setRegistered(codes);
			setError(null);
		} catch (err) {
			setRegistered([]);
			setError((err as Error).message);
		}
	}, [b24]);

	useEffect(() => {
		if (status === "ready") void refresh();
	}, [status, refresh]);

	const registerAll = () => {
		if (!b24 || !handler) return;
		startTransition(async () => {
			setError(null);
			const toastId = toast.loading("Добавляем каналы в CRM…");
			try {
				for (const provider of MESSAGE_SENDER_PROVIDERS) {
					// Уже зарегистрированный провайдер обновляем — так кнопка
					// заодно чинит HANDLER после смены домена apps/bitrix-webhook.
					const exists = registered?.includes(provider.code);
					const res = await b24.actions.v2.call.make({
						method: exists
							? "messageservice.sender.update"
							: "messageservice.sender.add",
						params: {
							CODE: provider.code,
							...(exists ? {} : { TYPE: "SMS" }),
							HANDLER: handler,
							NAME: provider.name,
							DESCRIPTION: provider.description,
						},
						requestId: Text.getUuidRfc4122(),
					});
					if (!res.isSuccess) {
						throw new Error(
							`${provider.name}: ${explainError(res.getErrorMessages())}`,
						);
					}
				}
				await refresh();
				toast.success(
					"Каналы добавлены — они появятся в CRM → «Каналы для отправки сообщений»",
					{ id: toastId, duration: 8000 },
				);
			} catch (err) {
				const message = (err as Error).message;
				setError(message);
				toast.error(message, { id: toastId });
			}
		});
	};

	const unregister = (code: string) => {
		if (!b24) return;
		startTransition(async () => {
			const toastId = toast.loading("Убираем канал из CRM…");
			try {
				const res = await b24.actions.v2.call.make({
					method: "messageservice.sender.delete",
					params: { CODE: code },
					requestId: Text.getUuidRfc4122(),
				});
				if (!res.isSuccess) {
					throw new Error(explainError(res.getErrorMessages()));
				}
				await refresh();
				toast.success("Канал убран", { id: toastId });
			} catch (err) {
				toast.error((err as Error).message, { id: toastId });
			}
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Каналы для отправки сообщений из CRM</CardTitle>
				<CardDescription>
					Личные номера WhatsApp и Telegram в списке CRM → «Каналы для отправки
					сообщений»: менеджер пишет клиенту первым из карточки («Написать
					клиенту») или роботом «Отправить SMS», ответ клиента приходит в
					Открытую линию номера. Сначала подключите сам номер (карточки ниже).
					Официальные боты и личный MAX сюда не добавляются — они не могут
					написать первым по номеру телефона.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{status === "standalone" && (
					<p className="text-sm text-muted-foreground">
						Регистрация доступна только внутри Битрикс24.
					</p>
				)}

				{status === "ready" && (
					<>
						{!handler && (
							<p className="text-sm text-destructive">
								NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL не задан — не на что
								направить отправку сообщений.
							</p>
						)}

						<div className="flex flex-col gap-2">
							{MESSAGE_SENDER_PROVIDERS.map((provider) => {
								const isRegistered = registered?.includes(provider.code);
								return (
									<div
										key={provider.code}
										className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm"
									>
										<div className="flex items-center gap-2">
											<span>{provider.name}</span>
											<Badge
												variant={isRegistered ? "secondary" : "outline"}
												className="text-[10px]"
											>
												{registered === null
													? "…"
													: isRegistered
														? "в CRM"
														: "не добавлен"}
											</Badge>
										</div>
										{isRegistered && (
											<Button
												variant="outline"
												size="sm"
												disabled={busy}
												onClick={() => unregister(provider.code)}
											>
												Убрать
											</Button>
										)}
									</div>
								);
							})}
						</div>

						<div>
							<Button
								onClick={registerAll}
								disabled={busy || !handler || registered === null}
								size="sm"
							>
								{busy && <Loader2Icon className="size-4 animate-spin" />}
								{registered?.length ? "Обновить каналы" : "Добавить в CRM"}
							</Button>
						</div>

						{error && <p className="text-sm text-destructive">{error}</p>}
					</>
				)}
			</CardContent>
		</Card>
	);
}
