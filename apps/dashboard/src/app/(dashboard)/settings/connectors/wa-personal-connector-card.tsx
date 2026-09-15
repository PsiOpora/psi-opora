"use client";

import { Text } from "@bitrix24/b24jssdk";
import type { WhatsappPersonalAccountView } from "@psi-opora/api";
import { Loader2Icon, PlusIcon, RefreshCwIcon } from "lucide-react";
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
import { subscribeConnectorEvents } from "@/lib/bitrix/connector-events";
import { orpcClient } from "@/lib/orpc/client";

// Совпадает с дефолтом WA_PERSONAL_CONNECTOR_ID (packages/config/src/env.ts) —
// клиентский код не видит серверный env, поэтому префикс здесь захардкожен,
// как и раньше. Каждый номер регистрируется под своим CONNECTOR_PREFIX_${slug}
// (см. generateConnectorId в routers/whatsapp-personal/helpers.ts), поэтому
// на одной линии может быть активно сразу несколько таких коннекторов.
const CONNECTOR_PREFIX = "psiopora_wa_personal";
const CONNECTOR_NAME = "WhatsApp (личный номер)";
const BITRIX_WEBHOOK_APP_URL = process.env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL;

// WhatsApp-иконка — Bitrix24 отклоняет регистрацию коннектора без неё
// (ICON_REQUIRED). DATA_IMAGE принимает data URI без CSS-обёртки url(...).
const ICON_SVG =
	"data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20fill%3D%22%23fff%22%20height%3D%22512%22%20width%3D%22512%22%3E%3Crect%20width%3D%22512%22%20height%3D%22512%22%20fill%3D%22%2345d354%22%20rx%3D%2215%25%22/%3E%3Cpath%20d%3D%22M308%20273c-3-2-6-3-9%201l-12%2016c-3%202-5%203-9%201-15-8-36-17-54-47-1-4%201-6%203-8l9-14c2-2%201-4%200-6l-12-29c-3-8-6-7-9-7h-8c-2%200-6%201-10%205-22%2022-13%2053%203%2073%203%204%2023%2040%2066%2059%2032%2014%2039%2012%2048%2010%2011-1%2022-10%2027-19%201-3%206-16%202-18m-79%2094c-41%200-72-22-72-22l-49%2013%2012-48s-20-31-20-70c0-72%2059-132%20132-132%2068%200%20126%2053%20126%20127%200%2072-58%20131-129%20132m-159%2029l83-23a158%20158%200%200%200%20230-140c0-86-68-155-154-155a158%20158%200%200%200-137%20236%22/%3E%3C/svg%3E";

function handlerUrl(): string {
	return `${window.location.origin}/api/bitrix/wa-personal-widget`;
}

const STATUS_LABELS: Record<string, string> = {
	connected: "подключён",
	limited: "временно ограничен",
	error: "ошибка",
};

/**
 * Управление коннекторами Открытых линий «WhatsApp (личный номер)» — каждый
 * подключаемый номер регистрируется как отдельный коннектор Bitrix24
 * (imconnector.register), что позволяет активировать несколько номеров на
 * одной линии одновременно (imconnector.activate — это слот на пару
 * CONNECTOR+LINE, а не на LINE целиком). Сам логин конкретного номера на
 * конкретной линии происходит нативно в Контакт-центре Bitrix24 —
 * администратор добавляет один из зарегистрированных здесь коннекторов как
 * канал на линии (откроется /widget/wa-personal-connector).
 */
export function WaPersonalConnectorCard() {
	const { b24, status } = useB24Frame();
	const [registeredIds, setRegisteredIds] = useState<string[]>([]);
	const [registeredNames, setRegisteredNames] = useState<
		Record<string, string>
	>({});
	const [accounts, setAccounts] = useState<WhatsappPersonalAccountView[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, startTransition] = useTransition();

	const refreshAccounts = useCallback(async () => {
		try {
			const { accounts: rows } = await orpcClient.whatsappPersonal.list();
			setAccounts(rows);
		} catch (err) {
			setError((err as Error).message);
		}
	}, []);

	const refreshRegistered = useCallback(async () => {
		if (!b24) return;
		try {
			const res = await b24.actions.v2.call.make({
				method: "imconnector.list",
				params: {},
				requestId: Text.getUuidRfc4122(),
			});
			if (!res.isSuccess) return;
			// result — объект `{connector_id: connector_name}`, а не массив
			// (см. документацию imconnector.list).
			const list = (
				res.getData() as { result?: Record<string, string> } | undefined
			)?.result;
			const ownConnectors = Object.fromEntries(
				Object.entries(list ?? {}).filter(([id]) =>
					id.startsWith(CONNECTOR_PREFIX),
				),
			);
			setRegisteredIds(Object.keys(ownConnectors));
			setRegisteredNames(ownConnectors);
		} catch {
			// не критично — просто не покажем незанятые слоты
		}
	}, [b24]);

	useEffect(() => {
		if (status === "ready") {
			void refreshRegistered();
			void refreshAccounts();
		}
	}, [status, refreshRegistered, refreshAccounts]);

	const addSlot = () => {
		if (!b24) return;
		startTransition(async () => {
			setError(null);
			const toastId = toast.loading("Регистрируем номер…");
			try {
				const slot = await orpcClient.whatsappPersonal.registerSlot();
				if (slot.error || !slot.connectorId) {
					throw new Error(slot.error ?? "Не удалось сгенерировать коннектор");
				}

				const res = await b24.actions.v2.call.make({
					method: "imconnector.register",
					params: {
						ID: slot.connectorId,
						NAME: `${CONNECTOR_NAME} №${registeredIds.length + 1}`,
						ICON: {
							DATA_IMAGE: ICON_SVG,
							COLOR: "#25D366",
							SIZE: "100%",
							POSITION: "center",
						},
						PLACEMENT_HANDLER: handlerUrl(),
						CHAT_GROUP: "N",
					},
					requestId: Text.getUuidRfc4122(),
				});
				if (!res.isSuccess) {
					throw new Error(res.getErrorMessages().join("; "));
				}
				await refreshRegistered();
				toast.success(
					"Номер зарегистрирован — откройте линию в Контакт-центре и добавьте этот канал",
					{ id: toastId, duration: 8000 },
				);

				if (BITRIX_WEBHOOK_APP_URL) {
					const failures = await subscribeConnectorEvents(
						b24,
						BITRIX_WEBHOOK_APP_URL,
					);
					if (failures.length > 0) {
						toast.error(
							`Не удалось подписаться на события: ${failures.join("; ")}`,
						);
					}
				} else {
					toast.warning(
						"NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL не задан — ответы оператора не будут доставляться без ручной настройки исходящего вебхука в Bitrix24",
					);
				}
			} catch (err) {
				const message = (err as Error).message;
				setError(message);
				toast.error(message, { id: toastId });
			}
		});
	};

	const updateRegistered = () => {
		if (!b24 || registeredIds.length === 0) return;
		startTransition(async () => {
			setError(null);
			const toastId = toast.loading("Обновляем карточки WhatsApp…");
			try {
				for (const [index, connectorId] of registeredIds.entries()) {
					const res = await b24.actions.v2.call.make({
						method: "imconnector.register",
						params: {
							ID: connectorId,
							NAME:
								registeredNames[connectorId] ??
								`${CONNECTOR_NAME} №${index + 1}`,
							ICON: {
								DATA_IMAGE: ICON_SVG,
								COLOR: "#25D366",
								SIZE: "100%",
								POSITION: "center",
							},
							PLACEMENT_HANDLER: handlerUrl(),
							CHAT_GROUP: "N",
						},
						requestId: Text.getUuidRfc4122(),
					});
					if (!res.isSuccess) {
						throw new Error(res.getErrorMessages().join("; "));
					}
				}
				await refreshRegistered();
				toast.success("Карточки WhatsApp обновлены", { id: toastId });
			} catch (err) {
				const message = (err as Error).message;
				setError(message);
				toast.error(message, { id: toastId });
			}
		});
	};

	const disconnectAccount = (lineId: string, connectorId: string) => {
		startTransition(async () => {
			const toastId = toast.loading("Отключаем номер…");
			try {
				const res = await orpcClient.whatsappPersonal.disconnect({
					lineId,
					connectorId,
				});
				if (res.error) throw new Error(res.error);
				await Promise.all([refreshAccounts(), refreshRegistered()]);
				toast.success("Номер отключён", { id: toastId });
			} catch (err) {
				toast.error((err as Error).message, { id: toastId });
			}
		});
	};

	const pendingSlots = registeredIds.filter(
		(id) => !accounts.some((acc) => acc.connectorId === id),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>WhatsApp — личный номер</CardTitle>
				<CardDescription>
					Отдельный канал Открытых линий через WAHA: реальный номер телефона —
					можно писать клиенту первым. На одну линию можно добавить сразу
					несколько номеров — каждый нужно сперва зарегистрировать здесь, а
					затем подключить в Контакт-центре (Bitrix24 откроет форму: телефон →
					код привязки, который вводится в WhatsApp на самом телефоне).
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{status === "standalone" && (
					<p className="text-sm text-muted-foreground">
						Регистрация коннектора доступна только внутри Битрикс24.
					</p>
				)}

				{status === "ready" && (
					<>
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="secondary">
								зарегистрировано номеров: {registeredIds.length}
							</Badge>
							<Button onClick={addSlot} disabled={busy} size="sm">
								{busy ? (
									<Loader2Icon className="size-4 animate-spin" />
								) : (
									<PlusIcon className="size-4" />
								)}
								Добавить номер
							</Button>
							{registeredIds.length > 0 && (
								<Button
									onClick={updateRegistered}
									disabled={busy}
									size="sm"
									variant="outline"
								>
									<RefreshCwIcon className="size-4" />
									Обновить карточки
								</Button>
							)}
						</div>

						{error && <p className="text-sm text-destructive">{error}</p>}

						{pendingSlots.length > 0 && (
							<div className="flex flex-col gap-1">
								{pendingSlots.map((id) => (
									<p key={id} className="text-xs text-muted-foreground">
										Зарегистрирован, но ещё не подключён — откройте линию в
										Контакт-центре и добавьте канал «{CONNECTOR_NAME}».
									</p>
								))}
							</div>
						)}

						{accounts.length > 0 && (
							<div className="flex flex-col gap-2">
								{accounts.map((acc) => (
									<div
										key={acc.connectorId}
										className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm"
									>
										<div className="flex flex-col gap-1">
											<div className="flex items-center gap-2">
												<span>{acc.phone}</span>
												<span className="text-xs text-muted-foreground">
													линия {acc.lineId}
												</span>
												<Badge variant="outline" className="text-[10px]">
													{STATUS_LABELS[acc.status] ?? acc.status}
												</Badge>
											</div>
											{acc.lastError && (
												<p className="max-w-xl text-xs text-destructive">
													{acc.lastError}
												</p>
											)}
										</div>
										<Button
											variant="outline"
											size="sm"
											disabled={busy}
											onClick={() =>
												disconnectAccount(acc.lineId, acc.connectorId)
											}
										>
											Отключить
										</Button>
									</div>
								))}
							</div>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
