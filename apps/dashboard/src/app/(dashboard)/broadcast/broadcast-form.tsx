"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type {
	BroadcastChannel,
	BroadcastReport,
	RecentBroadcastInfo,
} from "@psi-opora/api";
import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import { orpcClient } from "@/lib/orpc/client";
import { broadcastsListKey } from "./history";
import { MessageEditor } from "./message-editor";
import { RecipientsReport } from "./recipients-report";
import { SendConfirmation } from "./send-confirmation";
import { TelegramPreview } from "./telegram-preview";

export interface StageOption {
	stageId: string;
	stageName: string;
	sort: number;
	categoryId: string;
	categoryName: string;
}

const CHANNEL_LABEL: Record<BroadcastChannel, string> = {
	auto: "Авто — Telegram или MAX (что есть у контакта)",
	telegram: "Только Telegram",
	max: "Только MAX",
};

export function BroadcastForm({ stages }: { stages: StageOption[] }) {
	const queryClient = useQueryClient();
	const [stageId, setStageId] = useState("");
	const [channel, setChannel] = useState<BroadcastChannel>("auto");
	const [message, setMessage] = useState("");
	const [report, setReport] = useState<BroadcastReport | null>(null);
	const [recentBroadcast, setRecentBroadcast] =
		useState<RecentBroadcastInfo | null>(null);
	const [previewSig, setPreviewSig] = useState<string | null>(null);
	const [reportKey, setReportKey] = useState(0);
	const [confirming, setConfirming] = useState(false);
	const [ackChecked, setAckChecked] = useState(false);
	const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
		new Set(),
	);
	const [queued, setQueued] = useState<{
		broadcastId: string;
		count: number;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const categories = new Map<string, StageOption[]>();
	for (const stage of stages) {
		const list = categories.get(stage.categoryName) ?? [];
		list.push(stage);
		categories.set(stage.categoryName, list);
	}

	const selectedStage = stages.find((s) => s.stageId === stageId);
	const stageLabel = selectedStage
		? `${selectedStage.categoryName} — ${selectedStage.stageName}`
		: stageId;

	const trimmed = message.trim();
	const overLimit = trimmed.length > MESSAGE_MAX_LENGTH;
	const currentSig = JSON.stringify([stageId, channel, trimmed]);
	const previewFresh = report?.dryRun && previewSig === currentSig;
	const pendingRecipients = report
		? report.recipients.filter((r) => r.status === "pending")
		: [];
	const sendableCount =
		selectedContactIds.size > 0
			? pendingRecipients.filter((r) => selectedContactIds.has(r.contactId))
					.length
			: pendingRecipients.length;
	const canSend =
		previewFresh && sendableCount > 0 && trimmed.length > 0 && !overLimit;

	const toggleContact = (contactId: string) => {
		setSelectedContactIds((prev) => {
			const next = new Set(prev);
			if (next.has(contactId)) next.delete(contactId);
			else next.add(contactId);
			return next;
		});
	};

	const toggleManyContacts = (contactIds: string[], checked: boolean) => {
		setSelectedContactIds((prev) => {
			const next = new Set(prev);
			for (const id of contactIds) {
				if (checked) next.add(id);
				else next.delete(id);
			}
			return next;
		});
	};

	const sendHint = !stageId
		? "Выберите стадию сделки."
		: overLimit
			? `Сообщение слишком длинное: ${trimmed.length} из ${MESSAGE_MAX_LENGTH} символов.`
			: !trimmed
				? "Введите текст сообщения."
				: !previewFresh
					? report
						? "Параметры изменились после предпросмотра — нажмите «Показать получателей» ещё раз."
						: "Отправка откроется после предпросмотра: нажмите «Показать получателей» и проверьте список."
					: sendableCount === 0
						? "Среди получателей нет ни одного с привязанным Telegram или MAX."
						: null;

	const runPreview = () => {
		setConfirming(false);
		setAckChecked(false);
		setQueued(null);
		setSelectedContactIds(new Set());
		startTransition(async () => {
			setError(null);
			const result = await orpcClient.broadcast.send({
				stageId,
				stageName: stageLabel,
				channel,
				message,
				dryRun: true,
			});
			if (result.error) {
				setError(result.error);
				setReport(null);
				setPreviewSig(null);
				setRecentBroadcast(null);
			} else {
				setReport(result.report ?? null);
				setRecentBroadcast(result.recentBroadcast ?? null);
				setPreviewSig(currentSig);
				setReportKey((k) => k + 1);
			}
		});
	};

	const runSend = () => {
		if (!report) return;
		const expectedRecipients = report.recipients.length;
		setConfirming(false);
		setAckChecked(false);
		startTransition(async () => {
			setError(null);
			const result = await orpcClient.broadcast.send({
				stageId,
				stageName: stageLabel,
				channel,
				message,
				dryRun: false,
				expectedRecipients,
				selectedContactIds:
					selectedContactIds.size > 0 ? [...selectedContactIds] : undefined,
			});
			if (result.error) {
				setError(result.error);
			} else if (result.queuedBroadcastId) {
				setQueued({
					broadcastId: result.queuedBroadcastId,
					count: result.queuedCount ?? 0,
				});
				setReport(null);
				setPreviewSig(null);
				queryClient.invalidateQueries({ queryKey: broadcastsListKey });
			}
		});
	};

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Параметры рассылки</CardTitle>
					<CardDescription>
						Сообщение получит контакт каждой сделки на выбранной стадии — один
						раз, даже если сделок у контакта несколько. Отправка возможна только
						после предпросмотра списка получателей.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs text-muted-foreground">
								Стадия сделки
							</Label>
							<Select value={stageId} onValueChange={setStageId}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Выберите стадию" />
								</SelectTrigger>
								<SelectContent>
									{[...categories.entries()].map(([categoryName, list]) => (
										<SelectGroup key={categoryName}>
											<SelectLabel>{categoryName}</SelectLabel>
											{list.map((stage) => (
												<SelectItem key={stage.stageId} value={stage.stageId}>
													{stage.stageName}
												</SelectItem>
											))}
										</SelectGroup>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs text-muted-foreground">Канал</Label>
							<Select
								value={channel}
								onValueChange={(v) => setChannel(v as BroadcastChannel)}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{(
										Object.entries(CHANNEL_LABEL) as [
											BroadcastChannel,
											string,
										][]
									).map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="outline"
								disabled={!stageId || isPending}
								onClick={runPreview}
							>
								{isPending ? "Загрузка…" : "Показать получателей"}
							</Button>
							<Button
								disabled={!canSend || isPending || confirming}
								onClick={() => setConfirming(true)}
							>
								Отправить рассылку…
							</Button>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
						<MessageEditor value={message} onChange={setMessage} />
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs text-muted-foreground">
								Как увидит клиент в Telegram
							</Label>
							<TelegramPreview text={message} />
						</div>
					</div>

					{sendHint && !confirming && (
						<p className="text-xs text-muted-foreground">{sendHint}</p>
					)}

					{error && (
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
					)}
				</CardContent>
			</Card>

			{queued && (
				<Card className="border-emerald-500/50">
					<CardHeader>
						<CardTitle>Рассылка запущена</CardTitle>
						<CardDescription>
							Отправка {queued.count} сообщений выполняется в фоне — страницу
							можно закрыть. Статусы получателей обновляются на странице
							рассылки, там же можно дослать сообщения при ошибках.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button asChild variant="outline">
							<Link href={`/broadcast/${queued.broadcastId}`}>
								Открыть статус рассылки
							</Link>
						</Button>
					</CardContent>
				</Card>
			)}

			{confirming && previewFresh && report && (
				<SendConfirmation
					stageLabel={stageLabel}
					channelLabel={CHANNEL_LABEL[channel]}
					message={trimmed}
					sendableCount={sendableCount}
					hasManualSelection={selectedContactIds.size > 0}
					skippedCount={report.skipped}
					recentBroadcast={recentBroadcast}
					ackChecked={ackChecked}
					onAckChange={setAckChecked}
					onConfirm={runSend}
					onCancel={() => {
						setConfirming(false);
						setAckChecked(false);
					}}
					isPending={isPending}
				/>
			)}

			{report && (
				<RecipientsReport
					key={reportKey}
					report={report}
					message={message}
					selectedIds={selectedContactIds}
					onToggle={toggleContact}
					onToggleMany={toggleManyContacts}
				/>
			)}
		</div>
	);
}
