"use client";

import type { OutreachAccountOption, OutreachOptions } from "@psi-opora/api";
import {
	formatPhone,
	MESSAGE_MAX_LENGTH,
	OUTREACH_DEFAULT_INTERVAL_SEC,
	OUTREACH_MAX_INTERVAL_SEC,
	OUTREACH_MIN_INTERVAL_SEC,
} from "@psi-opora/api/schemas";
import type { EmailListSummary, EmailTemplate } from "@psi-opora/db/queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc/client";
import { formatDuration } from "./outreach-format";

type MessengerChannel = "max" | "telegram" | "whatsapp";

const OFF = "off";

const CHANNELS: Array<{
	channel: MessengerChannel;
	label: string;
	settingsHint: string;
}> = [
	{
		channel: "max",
		label: "MAX",
		settingsHint: "Подключите личный номер MAX в разделе «Каналы».",
	},
	{
		channel: "telegram",
		label: "Telegram",
		settingsHint: "Подключите личный номер Telegram в разделе «Каналы».",
	},
	{
		channel: "whatsapp",
		label: "WhatsApp",
		settingsHint: "Подключите личный номер WhatsApp в разделе «Каналы».",
	},
];

const accountKey = (
	a: Pick<OutreachAccountOption, "openLineId" | "connectorId">,
) => `${a.openLineId}:${a.connectorId}`;

function firstConnected(accounts: OutreachAccountOption[]): string {
	const account = accounts.find((a) => a.status === "connected");
	return account ? accountKey(account) : OFF;
}

export function OutreachForm({
	lists,
	templates,
	options,
	initialListId,
}: {
	lists: EmailListSummary[];
	templates: EmailTemplate[];
	options: OutreachOptions;
	initialListId?: string;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [listId, setListId] = useState(
		initialListId && lists.some((l) => l.id === initialListId)
			? initialListId
			: "",
	);
	const [message, setMessage] = useState("");
	const [selectedAccounts, setSelectedAccounts] = useState<
		Record<MessengerChannel, string>
	>({
		max: firstConnected(options.max),
		telegram: firstConnected(options.telegram),
		whatsapp: firstConnected(options.whatsapp),
	});
	const emailAvailable = !("error" in options.email);
	const [emailEnabled, setEmailEnabled] = useState(
		emailAvailable && templates.length > 0,
	);
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [subject, setSubject] = useState(templates[0]?.subject ?? "");
	const [intervalSec, setIntervalSec] = useState(OUTREACH_DEFAULT_INTERVAL_SEC);

	const { data: preview, isFetching: previewLoading } = useQuery(
		orpc.outreach.preview.queryOptions({
			input: { listId },
			enabled: Boolean(listId),
		}),
	);

	const send = useMutation(
		orpc.outreach.send.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					`Рассылка запущена: ${result.queued.toLocaleString("ru-RU")} контактов`,
				);
				queryClient.invalidateQueries({ queryKey: orpc.outreach.key() });
				router.push(`/outreach/${result.campaignId}`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const accountFor = (channel: MessengerChannel) => {
		const key = selectedAccounts[channel];
		if (key === OFF) return null;
		const account = options[channel].find((a) => accountKey(a) === key);
		return account
			? { openLineId: account.openLineId, connectorId: account.connectorId }
			: null;
	};
	const enabledChannels = CHANNELS.filter((c) => accountFor(c.channel));
	const useEmail = emailEnabled && emailAvailable;

	const trimmed = message.trim();
	const problems: string[] = [];
	if (!listId) problems.push("выберите список");
	if (!trimmed) problems.push("введите текст сообщения");
	if (trimmed.length > MESSAGE_MAX_LENGTH)
		problems.push(`сообщение длиннее ${MESSAGE_MAX_LENGTH} символов`);
	if (enabledChannels.length === 0 && !useEmail)
		problems.push("включите хотя бы один канал");
	if (useEmail && (!templateId || !subject.trim()))
		problems.push("выберите шаблон и тему письма");
	if (
		intervalSec < OUTREACH_MIN_INTERVAL_SEC ||
		intervalSec > OUTREACH_MAX_INTERVAL_SEC
	)
		problems.push(
			`пауза — от ${OUTREACH_MIN_INTERVAL_SEC} до ${OUTREACH_MAX_INTERVAL_SEC} с`,
		);
	if (preview && preview.total === 0) problems.push("список пуст");

	const messengerSends =
		enabledChannels.length > 0 ? (preview?.withPhone ?? 0) : 0;
	const routeSummary = [
		...enabledChannels.map((c) => c.label),
		...(useEmail ? ["Email"] : []),
	].join(" → ");

	const submit = () => {
		if (!preview) return;
		const template = templates.find((t) => t.id === templateId);
		send.mutate({
			listId,
			message: trimmed,
			accounts: {
				max: accountFor("max"),
				telegram: accountFor("telegram"),
				whatsapp: accountFor("whatsapp"),
			},
			intervalSec,
			email: useEmail
				? { templateId, templateName: template?.title, subject: subject.trim() }
				: null,
			expectedRecipients: preview.total,
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Новая рассылка</CardTitle>
				<CardDescription>
					Каждому контакту сообщение пробуется с личных номеров по очереди: MAX
					→ Telegram → WhatsApp. Если ни один мессенджер не доставил (номера нет
					в мессенджере, номер скрыт настройками приватности) — отправляется
					письмо. Один контакт получает сообщение только по одному каналу.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				<div className="flex flex-col gap-1.5">
					<Label>Список контактов</Label>
					{lists.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Списков ещё нет —{" "}
							<Link
								href="/email-lists"
								className="underline underline-offset-2"
							>
								создайте список
							</Link>{" "}
							и загрузите в него телефоны.
						</p>
					) : (
						<Select value={listId} onValueChange={setListId}>
							<SelectTrigger className="w-full md:w-96">
								<SelectValue placeholder="Выберите список" />
							</SelectTrigger>
							<SelectContent>
								{lists.map((list) => (
									<SelectItem key={list.id} value={list.id}>
										{list.name} · {list.contactsCount.toLocaleString("ru-RU")}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{listId && (
						<p className="text-sm text-muted-foreground">
							{previewLoading || !preview
								? "Считаем контакты…"
								: `Контактов: ${preview.total.toLocaleString("ru-RU")} · с телефоном (пойдут в мессенджеры): ${preview.withPhone.toLocaleString("ru-RU")} · только email: ${preview.emailOnly.toLocaleString("ru-RU")}${preview.suppressed > 0 ? ` · email в стоп-листе: ${preview.suppressed.toLocaleString("ru-RU")}` : ""}`}
						</p>
					)}
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="outreach-message">Текст сообщения</Label>
					<Textarea
						id="outreach-message"
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder="Здравствуйте, {{name}}! …"
						className="min-h-36"
						maxLength={MESSAGE_MAX_LENGTH + 500}
					/>
					<p className="text-xs text-muted-foreground">
						{"{{name}}"} заменяется на имя из списка (если имени нет — убирается
						вместе с запятой перед ним). {trimmed.length} / {MESSAGE_MAX_LENGTH}
					</p>
				</div>

				<div className="flex flex-col gap-3">
					<Label>Каналы по приоритету</Label>
					{CHANNELS.map((c, index) => {
						const accounts = options[c.channel];
						return (
							<div
								key={c.channel}
								className="grid grid-cols-1 items-center gap-2 md:grid-cols-[10rem_1fr]"
							>
								<span className="text-sm font-medium">
									{index + 1}. {c.label}
								</span>
								{accounts.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{c.settingsHint}
									</p>
								) : (
									<Select
										value={selectedAccounts[c.channel]}
										onValueChange={(value) =>
											setSelectedAccounts((prev) => ({
												...prev,
												[c.channel]: value,
											}))
										}
									>
										<SelectTrigger className="w-full md:w-96">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={OFF}>Не использовать</SelectItem>
											{accounts.map((a) => (
												<SelectItem
													key={accountKey(a)}
													value={accountKey(a)}
													disabled={a.status !== "connected"}
												>
													{formatPhone(a.phone)}
													{a.status !== "connected" && ` (${a.status})`}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							</div>
						);
					})}

					<div className="grid grid-cols-1 items-start gap-2 md:grid-cols-[10rem_1fr]">
						<span className="pt-0.5 text-sm font-medium">4. Email</span>
						{"error" in options.email ? (
							<p className="text-sm text-muted-foreground">
								{options.email.error}
							</p>
						) : templates.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								Нет шаблонов писем —{" "}
								<Link
									href="/email-templates/new"
									className="underline underline-offset-2"
								>
									создайте шаблон
								</Link>
								.
							</p>
						) : (
							<div className="flex flex-col gap-3">
								<div className="flex items-center gap-2 text-sm">
									<Checkbox
										id="outreach-email"
										checked={emailEnabled}
										onCheckedChange={(checked) =>
											setEmailEnabled(checked === true)
										}
									/>
									<Label htmlFor="outreach-email" className="font-normal">
										Отправить письмо, если мессенджеры не сработали (отправитель{" "}
										{options.email.senderEmail})
									</Label>
								</div>
								{emailEnabled && (
									<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
										<div className="flex flex-col gap-1.5">
											<Label className="text-xs text-muted-foreground">
												Шаблон письма
											</Label>
											<Select
												value={templateId}
												onValueChange={(value) => {
													setTemplateId(value);
													const template = templates.find(
														(t) => t.id === value,
													);
													if (template) setSubject(template.subject);
												}}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Выберите шаблон" />
												</SelectTrigger>
												<SelectContent>
													{templates.map((t) => (
														<SelectItem key={t.id} value={t.id}>
															{t.title}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="flex flex-col gap-1.5">
											<Label
												htmlFor="outreach-subject"
												className="text-xs text-muted-foreground"
											>
												Тема письма
											</Label>
											<Input
												id="outreach-subject"
												value={subject}
												onChange={(e) => setSubject(e.target.value)}
												maxLength={300}
											/>
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="outreach-interval">
						Пауза между сообщениями в мессенджеры, секунд
					</Label>
					<Input
						id="outreach-interval"
						type="number"
						min={OUTREACH_MIN_INTERVAL_SEC}
						max={OUTREACH_MAX_INTERVAL_SEC}
						value={intervalSec}
						onChange={(e) => setIntervalSec(Number(e.target.value))}
						className="w-32"
					/>
					<p className="text-xs text-muted-foreground">
						Личные номера блокируют за массовые сообщения незнакомым людям — не
						уменьшайте паузу без необходимости. Пауза случайно меняется на ±25%.
						{messengerSends > 0 &&
							` Отправка в мессенджеры займёт ${formatDuration(messengerSends * intervalSec)}.`}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								disabled={problems.length > 0 || !preview || send.isPending}
							>
								<SendIcon />
								{send.isPending ? "Запускаем…" : "Запустить рассылку"}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Запустить рассылку?</AlertDialogTitle>
								<AlertDialogDescription>
									{preview?.total.toLocaleString("ru-RU")} контактов из списка «
									{lists.find((l) => l.id === listId)?.name}». Порядок каналов:{" "}
									{routeSummary}. Отменить можно на странице отчёта, но уже
									отправленные сообщения не отзываются.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Отмена</AlertDialogCancel>
								<AlertDialogAction onClick={submit}>
									Запустить
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
					{problems.length > 0 && (
						<p className="text-sm text-muted-foreground">
							Чтобы запустить: {problems.join(", ")}.
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
