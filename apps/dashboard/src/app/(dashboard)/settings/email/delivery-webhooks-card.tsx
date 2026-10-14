"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc/client";

function CopyField({ value }: { value: string }) {
	return (
		<div className="flex gap-2">
			<Input readOnly value={value} className="font-mono text-xs" />
			<Button
				type="button"
				variant="outline"
				size="icon"
				aria-label="Скопировать"
				onClick={() =>
					navigator.clipboard
						.writeText(value)
						.then(() => toast.success("Скопировано"))
						.catch(() =>
							toast.error("Не удалось скопировать — выделите вручную"),
						)
				}
			>
				<CopyIcon />
			</Button>
		</div>
	);
}

/**
 * Подключение вебхуков статусов писем — без них по получателям видно только
 * «отправлено», а доставка/открытия/клики/отписки/bounce не приходят.
 */
export function DeliveryWebhooksCard() {
	const queryClient = useQueryClient();
	const { data: status, isLoading } = useQuery(
		orpc.email.webhooks.status.queryOptions(),
	);
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.email.webhooks.key() });

	const rotate = useMutation(
		orpc.email.webhooks.rotateRusenderSecret.mutationOptions({
			onSuccess: () => {
				toast.success(
					"Адрес вебхука создан — добавьте его в кабинете Rusender",
				);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const connectUnisender = useMutation(
		orpc.email.webhooks.connectUnisender.mutationOptions({
			onSuccess: () => {
				toast.success("Вебхук Unisender подключён");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Статистика доставки (вебхуки)</CardTitle>
				<CardDescription>
					Чтобы видеть по каждому получателю, доставлено ли письмо, открыто ли,
					был ли переход по ссылке, отписка или ошибка доставки, провайдер
					должен присылать события на наш сервер. Адреса с ошибкой доставки,
					жалобой и отпиской автоматически попадают в стоп-лист.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				{isLoading ? (
					<p className="text-sm text-muted-foreground">Загрузка…</p>
				) : !status?.appUrlConfigured ? (
					<p className="text-sm text-destructive">
						Не задан NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL — не известен адрес
						сервера, принимающего вебхуки (apps/bitrix-webhook).
					</p>
				) : (
					<>
						<section className="flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<h3 className="font-medium">Rusender</h3>
								{status.rusenderUrl ? (
									<Badge variant="secondary">Адрес создан</Badge>
								) : (
									<Badge variant="outline">Не настроен</Badge>
								)}
							</div>
							{status.rusenderUrl ? (
								<>
									<CopyField value={status.rusenderUrl} />
									<ol className="list-decimal pl-5 text-sm text-muted-foreground">
										<li>
											В кабинете Rusender откройте{" "}
											<a
												href="https://cabinet.rusender.ru/"
												target="_blank"
												rel="noreferrer"
												className="underline underline-offset-2"
											>
												Интеграции → Webhooks
											</a>{" "}
											и создайте вебхук с этим адресом.
										</li>
										<li>
											Отметьте события писем API/SMTP (external_mail):
											доставлено, открыто, клик, hard bounce, soft bounce,
											жалоба, отписка, ошибка.
										</li>
										<li>
											Включите в Rusender отслеживание открытий и переходов для
											домена отправки.
										</li>
									</ol>
									<div>
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button variant="ghost" size="sm">
													Перевыпустить адрес
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>
														Перевыпустить адрес вебхука?
													</AlertDialogTitle>
													<AlertDialogDescription>
														Старый адрес перестанет работать — новый нужно будет
														заменить в кабинете Rusender. Делайте это, если
														адрес мог попасть к посторонним.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Отмена</AlertDialogCancel>
													<AlertDialogAction onClick={() => rotate.mutate({})}>
														Перевыпустить
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									</div>
								</>
							) : (
								<div>
									<Button
										variant="outline"
										disabled={rotate.isPending}
										onClick={() => rotate.mutate({})}
									>
										Создать адрес вебхука
									</Button>
								</div>
							)}
						</section>

						<section className="flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<h3 className="font-medium">Unisender</h3>
								{status.unisenderConnected ? (
									<Badge variant="secondary">
										<CheckCircle2Icon />
										Подключён
									</Badge>
								) : (
									<Badge variant="outline">Не подключён</Badge>
								)}
							</div>
							{!status.unisenderConfigured ? (
								<p className="text-sm text-muted-foreground">
									Сначала сохраните API-ключ Unisender ниже.
								</p>
							) : (
								<>
									{status.unisenderError && (
										<p className="text-sm text-destructive">
											Не удалось проверить подписку: {status.unisenderError}
										</p>
									)}
									<p className="text-sm text-muted-foreground">
										Подписка оформляется автоматически через API Unisender
										(setHook) на адрес {status.unisenderUrl}.
									</p>
									<div>
										<Button
											variant="outline"
											disabled={connectUnisender.isPending}
											onClick={() => connectUnisender.mutate({})}
										>
											{status.unisenderConnected
												? "Переподключить"
												: "Подключить вебхук"}
										</Button>
									</div>
								</>
							)}
						</section>
					</>
				)}
			</CardContent>
		</Card>
	);
}
