"use client";

import type { OutreachOptions } from "@psi-opora/api";
import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import type { EmailListSummary, EmailTemplate } from "@psi-opora/db/queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { orpc } from "@/lib/orpc/client";
import { ChannelList } from "./channel-list";
import {
	activeChannels,
	type DeliveryDraft,
	defaultDraft,
	deliveryProblems,
	estimateDuration,
	loadDraft,
	MESSENGER_LABELS,
	saveDraft,
} from "./delivery-model";
import { DeliveryRules } from "./delivery-rules";
import { EmailFallback } from "./email-fallback";

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
	const [delivery, setDelivery] = useState<DeliveryDraft>(() =>
		loadDraft(options),
	);
	const emailAvailable = !("error" in options.email);
	const [emailEnabled, setEmailEnabled] = useState(
		emailAvailable && templates.length > 0,
	);
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [subject, setSubject] = useState(templates[0]?.subject ?? "");

	useEffect(() => saveDraft(delivery), [delivery]);
	const patchDelivery = (patch: Partial<DeliveryDraft>) =>
		setDelivery((prev) => ({ ...prev, ...patch }));

	const dedupDays = delivery.dedupEnabled ? delivery.dedupDays : null;
	const previewDedupDays = useDebouncedValue(dedupDays, 400);
	const { data: preview, isFetching: previewLoading } = useQuery(
		orpc.outreach.preview.queryOptions({
			input: { listId, dedupDays: previewDedupDays },
			enabled: Boolean(listId),
			placeholderData: (prev) => prev,
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

	const channels = activeChannels(delivery, options);
	const useEmail = emailEnabled && emailAvailable;
	const sendWindow = delivery.windowEnabled ? delivery.window : null;

	const trimmed = message.trim();
	const problems: string[] = [];
	if (!listId) problems.push("выберите список");
	if (!trimmed) problems.push("введите текст сообщения");
	if (trimmed.length > MESSAGE_MAX_LENGTH)
		problems.push(`сообщение длиннее ${MESSAGE_MAX_LENGTH} символов`);
	if (channels.length === 0 && !useEmail)
		problems.push("включите хотя бы один канал");
	if (useEmail && (!templateId || !subject.trim()))
		problems.push("выберите шаблон и тему письма");
	problems.push(...deliveryProblems(delivery));
	if (preview && preview.total === 0) problems.push("список пуст");

	const routeSummary = [
		...channels.map((c) => MESSENGER_LABELS[c.channel]),
		...(useEmail ? ["Email"] : []),
	].join(" → ");
	const duration =
		channels.length > 0 && preview
			? estimateDuration(preview.messengerCandidates, channels[0], sendWindow)
			: null;

	const submit = () => {
		if (!preview) return;
		const template = templates.find((t) => t.id === templateId);
		send.mutate({
			listId,
			message: trimmed,
			channels,
			onDailyLimit: delivery.onDailyLimit,
			window: sendWindow,
			dedupDays,
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
					Каждому контакту сообщение пробуется по каналам сверху вниз: если
					номера нет в мессенджере или отправка не удалась — следующий канал.
					Один контакт получает сообщение только по одному каналу.
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
							{previewLoading && !preview
								? "Считаем контакты…"
								: preview &&
									`Контактов: ${preview.total.toLocaleString("ru-RU")} · с телефоном (пойдут в мессенджеры): ${preview.withPhone.toLocaleString("ru-RU")} · только email: ${preview.emailOnly.toLocaleString("ru-RU")}${preview.suppressed > 0 ? ` · email в стоп-листе: ${preview.suppressed.toLocaleString("ru-RU")}` : ""}${preview.recentlyContacted > 0 ? ` · недавно получали рассылку: ${preview.recentlyContacted.toLocaleString("ru-RU")}` : ""}`}
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

				<Separator />

				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap items-end justify-between gap-2">
						<div>
							<Label>Каналы и порядок</Label>
							<p className="mt-1 text-xs text-muted-foreground">
								Стрелками меняется приоритет, переключателем канал выключается.
								Темп задаётся для каждого номера отдельно — блокируют именно
								номер.
							</p>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => setDelivery(defaultDraft(options))}
						>
							<RotateCcwIcon />
							Сбросить настройки
						</Button>
					</div>
					<ChannelList
						channels={delivery.channels}
						options={options}
						onChange={(next) => patchDelivery({ channels: next })}
					/>
					<EmailFallback
						options={options}
						templates={templates}
						step={useEmail ? channels.length + 1 : null}
						enabled={useEmail}
						onEnabledChange={setEmailEnabled}
						templateId={templateId}
						onTemplateChange={(template) => {
							setTemplateId(template.id);
							setSubject(template.subject);
						}}
						subject={subject}
						onSubjectChange={setSubject}
					/>
				</div>

				<Separator />

				<div className="flex flex-col gap-3">
					<Label>Правила отправки</Label>
					<DeliveryRules
						draft={delivery}
						onChange={patchDelivery}
						recentlyContacted={
							listId ? (preview?.recentlyContacted ?? null) : null
						}
					/>
				</div>

				<Separator />

				<div className="flex flex-col gap-3">
					{routeSummary && (
						<p className="text-sm">
							Цепочка: <span className="font-medium">{routeSummary}</span>
							{duration && (
								<span className="text-muted-foreground">
									{" "}
									· отправка в мессенджеры займёт {duration} (оценка, если все
									сообщения пойдут через первый канал)
								</span>
							)}
						</p>
					)}
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
										{preview?.total.toLocaleString("ru-RU")} контактов из списка
										«{lists.find((l) => l.id === listId)?.name}»
										{preview && preview.recentlyContacted > 0 && dedupDays
											? ` (из них ${preview.recentlyContacted.toLocaleString("ru-RU")} недавно получали рассылку — будут пропущены)`
											: ""}
										. Порядок каналов: {routeSummary}. Отменить можно на
										странице отчёта, но уже отправленные сообщения не
										отзываются.
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
				</div>
			</CardContent>
		</Card>
	);
}
