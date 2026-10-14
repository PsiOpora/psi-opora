"use client";

import type {
	EmailRecipientsReport,
	RecentEmailCampaignInfo,
} from "@psi-opora/api";
import type { EmailListSummary, EmailTemplate } from "@psi-opora/db/queries";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { orpc, orpcClient } from "@/lib/orpc/client";
import { RecipientsReport } from "./recipients-report";
import { SendConfirmation } from "./send-confirmation";

export interface StageOption {
	stageId: string;
	stageName: string;
	sort: number;
	categoryId: string;
	categoryName: string;
}

type Audience = "list" | "crm_stage";

export function EmailCampaignForm({
	stages,
	lists,
	templates,
	senderConfigured,
	initialListId,
}: {
	stages: StageOption[];
	lists: EmailListSummary[];
	templates: EmailTemplate[];
	senderConfigured: boolean;
	initialListId?: string;
}) {
	const queryClient = useQueryClient();
	const [audience, setAudience] = useState<Audience>(
		initialListId || stages.length === 0 ? "list" : "crm_stage",
	);
	const [stageId, setStageId] = useState("");
	const [listId, setListId] = useState(initialListId ?? "");
	const [templateId, setTemplateId] = useState("");
	const [subject, setSubject] = useState("");
	const subjectTouchedRef = useRef(false);
	const [previewBody, setPreviewBody] = useState<string | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [testEmail, setTestEmail] = useState("");
	const [testSending, setTestSending] = useState(false);
	const [report, setReport] = useState<EmailRecipientsReport | null>(null);
	const [recentCampaign, setRecentCampaign] =
		useState<RecentEmailCampaignInfo | null>(null);
	const [previewSig, setPreviewSig] = useState<string | null>(null);
	const [reportKey, setReportKey] = useState(0);
	const [confirming, setConfirming] = useState(false);
	const [ackChecked, setAckChecked] = useState(false);
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
	const [queued, setQueued] = useState<{
		campaignId: string;
		count: number;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const categories = new Map<string, StageOption[]>();
	for (const stage of stages) {
		const group = categories.get(stage.categoryName) ?? [];
		group.push(stage);
		categories.set(stage.categoryName, group);
	}

	const selectedStage = stages.find((s) => s.stageId === stageId);
	const selectedList = lists.find((l) => l.id === listId);
	const audienceLabel =
		audience === "list"
			? selectedList
				? `Список «${selectedList.name}»`
				: listId
			: selectedStage
				? `${selectedStage.categoryName} — ${selectedStage.stageName}`
				: stageId;
	const audienceChosen =
		audience === "list" ? Boolean(listId) : Boolean(stageId);
	const selectedTemplate = templates.find((t) => t.id === templateId);

	useEffect(() => {
		if (!templateId) {
			setPreviewBody(null);
			return;
		}
		let cancelled = false;
		setPreviewLoading(true);
		orpcClient.emailBroadcast.templatePreview({ templateId }).then((result) => {
			if (cancelled) return;
			setPreviewLoading(false);
			if (result.error) {
				setPreviewBody(null);
				return;
			}
			setPreviewBody(result.body ?? null);
			if (!subjectTouchedRef.current && result.subject)
				setSubject(result.subject);
		});
		return () => {
			cancelled = true;
		};
	}, [templateId]);

	const trimmedSubject = subject.trim();
	const currentSig = JSON.stringify([
		audience,
		audience === "list" ? listId : stageId,
		templateId,
		trimmedSubject,
	]);
	const previewFresh = report?.dryRun && previewSig === currentSig;
	const pendingRecipients = report
		? report.recipients.filter((r) => r.status === "pending")
		: [];
	const sendableCount =
		selectedKeys.size > 0
			? pendingRecipients.filter((r) => selectedKeys.has(r.key)).length
			: pendingRecipients.length;
	const canSend =
		previewFresh && sendableCount > 0 && trimmedSubject.length > 0;

	const toggleKey = (key: string) => {
		setSelectedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const toggleManyKeys = (keys: string[], checked: boolean) => {
		setSelectedKeys((prev) => {
			const next = new Set(prev);
			for (const key of keys) {
				if (checked) next.add(key);
				else next.delete(key);
			}
			return next;
		});
	};

	const sendHint = !senderConfigured
		? "Не задан email отправителя — настройте на странице /settings/email."
		: !audienceChosen
			? audience === "list"
				? "Выберите список контактов."
				: "Выберите стадию сделки."
			: !templateId
				? "Выберите шаблон письма."
				: !trimmedSubject
					? "Введите тему письма."
					: !previewFresh
						? report
							? "Параметры изменились после предпросмотра — нажмите «Показать получателей» ещё раз."
							: "Отправка откроется после предпросмотра: нажмите «Показать получателей» и проверьте список."
						: sendableCount === 0
							? "Среди получателей нет ни одного, кому можно отправить письмо."
							: null;

	const audienceInput = () =>
		audience === "list"
			? { audience, listId }
			: { audience, stageId, stageName: audienceLabel };

	const resetPreview = () => {
		setReport(null);
		setPreviewSig(null);
		setRecentCampaign(null);
		setSelectedKeys(new Set());
		setConfirming(false);
		setAckChecked(false);
	};

	const runPreview = () => {
		setConfirming(false);
		setAckChecked(false);
		setQueued(null);
		setSelectedKeys(new Set());
		startTransition(async () => {
			setError(null);
			const result = await orpcClient.emailBroadcast.send({
				...audienceInput(),
				templateId,
				templateName: selectedTemplate?.title,
				subject,
				dryRun: true,
			});
			if (result.error) {
				setError(result.error);
				setReport(null);
				setPreviewSig(null);
				setRecentCampaign(null);
			} else {
				setReport(result.report ?? null);
				setRecentCampaign(result.recentCampaign ?? null);
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
			const result = await orpcClient.emailBroadcast.send({
				...audienceInput(),
				templateId,
				templateName: selectedTemplate?.title,
				subject,
				dryRun: false,
				expectedRecipients,
				selectedKeys: selectedKeys.size > 0 ? [...selectedKeys] : undefined,
			});
			if (result.error) {
				setError(result.error);
			} else if (result.queuedCampaignId) {
				setQueued({
					campaignId: result.queuedCampaignId,
					count: result.queuedCount ?? 0,
				});
				setReport(null);
				setPreviewSig(null);
				queryClient.invalidateQueries({ queryKey: orpc.emailCampaigns.key() });
			}
		});
	};

	const sendTestToAddress = async () => {
		if (!templateId || !trimmedSubject || !testEmail.trim()) return;
		setTestSending(true);
		const toastId = toast.loading("Отправляем тестовое письмо…");
		const result = await orpcClient.emailBroadcast.sendTest({
			email: testEmail,
			templateId,
			subject,
		});
		setTestSending(false);
		if (result.ok)
			toast.success(`Тест отправлен на ${testEmail}`, { id: toastId });
		else toast.error(result.error ?? "Ошибка теста", { id: toastId });
	};

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Параметры рассылки</CardTitle>
					<CardDescription>
						Каждый адрес получит письмо один раз. Адреса из стоп-листа
						(отписавшиеся, несуществующие, пожаловавшиеся) исключаются
						автоматически. Отправка возможна только после предпросмотра
						получателей.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<Tabs
						value={audience}
						onValueChange={(value) => {
							setAudience(value as Audience);
							resetPreview();
						}}
					>
						<TabsList>
							<TabsTrigger value="list">Список контактов</TabsTrigger>
							<TabsTrigger value="crm_stage">Стадия сделок CRM</TabsTrigger>
						</TabsList>
					</Tabs>

					<div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
						{audience === "list" ? (
							<div className="flex flex-col gap-1.5">
								<Label className="text-xs text-muted-foreground">
									Список контактов
								</Label>
								{lists.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										Списков ещё нет —{" "}
										<Link
											href="/email-lists"
											className="underline underline-offset-2"
										>
											создайте и загрузите CSV
										</Link>
										.
									</p>
								) : (
									<Select value={listId} onValueChange={setListId}>
										<SelectTrigger className="w-full">
											<SelectValue placeholder="Выберите список" />
										</SelectTrigger>
										<SelectContent>
											{lists.map((l) => (
												<SelectItem key={l.id} value={l.id}>
													{l.name} ·{" "}
													{(l.contactsCount - l.suppressedCount).toLocaleString(
														"ru-RU",
													)}{" "}
													адресов
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							</div>
						) : (
							<div className="flex flex-col gap-1.5">
								<Label className="text-xs text-muted-foreground">
									Стадия сделки
								</Label>
								<Select value={stageId} onValueChange={setStageId}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Выберите стадию" />
									</SelectTrigger>
									<SelectContent>
										{[...categories.entries()].map(([categoryName, group]) => (
											<SelectGroup key={categoryName}>
												<SelectLabel>{categoryName}</SelectLabel>
												{group.map((stage) => (
													<SelectItem key={stage.stageId} value={stage.stageId}>
														{stage.stageName}
													</SelectItem>
												))}
											</SelectGroup>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs text-muted-foreground">
								Шаблон письма
							</Label>
							<Select value={templateId} onValueChange={setTemplateId}>
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
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="outline"
								disabled={!audienceChosen || !templateId || isPending}
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
						<div className="flex flex-col gap-4">
							<div className="flex flex-col gap-1.5">
								<Label
									htmlFor="subject"
									className="text-xs text-muted-foreground"
								>
									Тема письма
								</Label>
								<Input
									id="subject"
									value={subject}
									onChange={(e) => {
										setSubject(e.target.value);
										subjectTouchedRef.current = true;
									}}
									placeholder="Тема письма подтянется из шаблона — можно изменить"
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label
									htmlFor="test-email"
									className="text-xs text-muted-foreground"
								>
									Тестовое письмо себе — проверьте вид в почтовом клиенте перед
									рассылкой
								</Label>
								<form
									className="flex gap-2"
									onSubmit={(e) => {
										e.preventDefault();
										void sendTestToAddress();
									}}
								>
									<Input
										id="test-email"
										type="email"
										value={testEmail}
										onChange={(e) => setTestEmail(e.target.value)}
										placeholder="you@example.com"
									/>
									<Button
										type="submit"
										variant="outline"
										disabled={
											!templateId ||
											!trimmedSubject ||
											!testEmail.trim() ||
											testSending
										}
									>
										{testSending ? "Отправка…" : "Отправить тест"}
									</Button>
								</form>
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs text-muted-foreground">
								Как увидит получатель (превью шаблона)
							</Label>
							<div className="h-72 overflow-hidden rounded-md border bg-white">
								{previewLoading ? (
									<p className="p-3 text-sm text-muted-foreground">
										Загрузка превью…
									</p>
								) : previewBody ? (
									<iframe
										title="Превью письма"
										srcDoc={previewBody}
										sandbox=""
										className="h-full w-full"
									/>
								) : (
									<p className="p-3 text-sm text-muted-foreground">
										Выберите шаблон, чтобы увидеть превью.
									</p>
								)}
							</div>
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
							{queued.count.toLocaleString("ru-RU")} писем отправляются в фоне —
							страницу можно закрыть. Статусы доставки, открытия и клики
							появятся на странице рассылки по мере поступления.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button asChild variant="outline">
							<Link href={`/email-broadcast/${queued.campaignId}`}>
								Открыть статистику рассылки
							</Link>
						</Button>
					</CardContent>
				</Card>
			)}

			{confirming && previewFresh && report && (
				<SendConfirmation
					audienceKind={audience}
					audienceLabel={audienceLabel}
					templateLabel={selectedTemplate?.title ?? templateId}
					subject={trimmedSubject}
					sendableCount={sendableCount}
					hasManualSelection={selectedKeys.size > 0}
					skippedCount={report.skipped}
					recentCampaign={recentCampaign}
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
					subject={trimmedSubject}
					templateId={templateId}
					selectedIds={selectedKeys}
					onToggle={toggleKey}
					onToggleMany={toggleManyKeys}
				/>
			)}
		</div>
	);
}
