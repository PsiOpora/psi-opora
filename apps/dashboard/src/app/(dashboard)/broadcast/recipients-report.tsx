"use client";

import { useMemo, useState, useTransition } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { BroadcastRecipient, BroadcastReport } from "@psi-opora/api";
import { orpcClient } from "@/lib/orpc/client";

const STATUS_BADGE: Record<
	BroadcastRecipient["status"],
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
	}
> = {
	sent: { label: "Отправлено", variant: "default" },
	pending: { label: "Готов к отправке", variant: "secondary" },
	skipped: { label: "Пропущен", variant: "outline" },
	error: { label: "Ошибка", variant: "destructive" },
};

const MESSENGER_FILTERS = [
	{ value: "all", label: "Все мессенджеры" },
	{ value: "telegram", label: "Telegram" },
	{ value: "max", label: "MAX" },
	{ value: "none", label: "Без мессенджера" },
] as const;

const STATUS_FILTERS = [
	{ value: "all", label: "Все статусы" },
	{ value: "pending", label: "Готов к отправке" },
	{ value: "sent", label: "Отправлено" },
	{ value: "skipped", label: "Пропущен" },
	{ value: "error", label: "Ошибка" },
] as const;

const PAGE_SIZE = 20;

type TestResult = { ok: boolean; error?: string };

function messengerLabel(messenger: BroadcastRecipient["messenger"]): string {
	if (messenger === "telegram") return "Telegram";
	if (messenger === "max") return "MAX";
	return "—";
}

export function RecipientsReport({
	report,
	message,
	selectedIds,
	onToggle,
	onToggleMany,
}: {
	report: BroadcastReport;
	message: string;
	selectedIds: Set<string>;
	onToggle: (contactId: string) => void;
	onToggleMany: (contactIds: string[], checked: boolean) => void;
}) {
	const [messengerFilter, setMessengerFilter] = useState("all");
	const [statusFilter, setStatusFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const [testResults, setTestResults] = useState<Record<string, TestResult>>(
		{},
	);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [testCandidate, setTestCandidate] = useState<BroadcastRecipient | null>(
		null,
	);
	const [, startTransition] = useTransition();

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		return report.recipients.filter((r) => {
			if (messengerFilter === "none" && r.messenger) return false;
			if (
				(messengerFilter === "telegram" || messengerFilter === "max") &&
				r.messenger !== messengerFilter
			) {
				return false;
			}
			if (statusFilter !== "all" && r.status !== statusFilter) return false;
			if (
				query &&
				!r.contactName.toLowerCase().includes(query) &&
				!r.dealTitle.toLowerCase().includes(query)
			) {
				return false;
			}
			return true;
		});
	}, [report.recipients, messengerFilter, statusFilter, search]);

	const selectableIds = useMemo(
		() =>
			filtered.filter((r) => r.status === "pending").map((r) => r.contactId),
		[filtered],
	);
	const selectedInFilter = selectableIds.filter((id) => selectedIds.has(id));
	const allFilteredSelected =
		selectableIds.length > 0 &&
		selectedInFilter.length === selectableIds.length;
	const someFilteredSelected =
		selectedInFilter.length > 0 && !allFilteredSelected;

	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const rows = filtered.slice(
		currentPage * PAGE_SIZE,
		(currentPage + 1) * PAGE_SIZE,
	);

	const confirmTest = () => {
		if (!testCandidate) return;
		const { messenger, userId, contactId } = testCandidate;
		if (!messenger || !userId) return;
		setTestingId(contactId);
		startTransition(async () => {
			const toastId = toast.loading("Отправляем тестовое сообщение…");
			const result = await orpcClient.broadcast.sendTest({
				messenger,
				userId,
				message,
			});
			setTestResults((prev) => ({ ...prev, [contactId]: result }));
			setTestingId(null);
			if (result.ok) {
				toast.success("Тест отправлен", { id: toastId });
			} else {
				toast.error(result.error ?? "Ошибка теста", { id: toastId });
			}
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{report.dryRun ? "Предпросмотр получателей" : "Результат рассылки"}
				</CardTitle>
				<CardDescription>
					Сделок на стадии: {report.totalDeals} · Получателей:{" "}
					{report.recipients.length}
					{report.dryRun
						? ` · Без мессенджера: ${report.skipped}`
						: ` · Отправлено: ${report.sent} · Пропущено: ${report.skipped} · Ошибок: ${report.failed}`}
					{report.dryRun &&
						" · Кнопка «Тест» отправляет текущий текст сообщения только выбранному контакту."}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{report.recipients.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						На выбранной стадии нет сделок с привязанными контактами.
					</p>
				) : (
					<>
						<div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(200px,2fr)_minmax(160px,1fr)_minmax(160px,1fr)]">
							<Input
								value={search}
								onChange={(e) => {
									setSearch(e.target.value);
									setPage(0);
								}}
								placeholder="Поиск по контакту или сделке…"
							/>
							<Select
								value={messengerFilter}
								onValueChange={(v) => {
									setMessengerFilter(v);
									setPage(0);
								}}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{MESSENGER_FILTERS.map((f) => (
										<SelectItem key={f.value} value={f.value}>
											{f.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select
								value={statusFilter}
								onValueChange={(v) => {
									setStatusFilter(v);
									setPage(0);
								}}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{STATUS_FILTERS.map((f) => (
										<SelectItem key={f.value} value={f.value}>
											{f.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{report.dryRun && (
							<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
								<span className="text-muted-foreground">
									{selectedIds.size > 0
										? `Отмечено получателей: ${selectedIds.size}. Сообщение получат только они.`
										: "Никто не отмечен — сообщение получат все готовые к отправке."}
								</span>
								{selectedIds.size > 0 && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => onToggleMany([...selectedIds], false)}
									>
										Сбросить выбор
									</Button>
								)}
							</div>
						)}

						{filtered.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								Никто не подходит под выбранные фильтры.
							</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										{report.dryRun && (
											<TableHead className="w-8">
												<Checkbox
													checked={
														allFilteredSelected
															? true
															: someFilteredSelected
																? "indeterminate"
																: false
													}
													disabled={selectableIds.length === 0}
													onCheckedChange={(checked) =>
														onToggleMany(selectableIds, checked === true)
													}
													aria-label="Выбрать всех подходящих под фильтр"
												/>
											</TableHead>
										)}
										<TableHead>Контакт</TableHead>
										<TableHead>Сделка</TableHead>
										<TableHead>Мессенджер</TableHead>
										<TableHead>Статус</TableHead>
										{report.dryRun && <TableHead />}
									</TableRow>
								</TableHeader>
								<TableBody>
									{rows.map((r) => {
										const badge = STATUS_BADGE[r.status];
										const test = testResults[r.contactId];
										return (
											<TableRow key={r.contactId}>
												{report.dryRun && (
													<TableCell>
														<Checkbox
															checked={selectedIds.has(r.contactId)}
															disabled={r.status !== "pending"}
															onCheckedChange={() => onToggle(r.contactId)}
															aria-label={`Выбрать ${r.contactName}`}
														/>
													</TableCell>
												)}
												<TableCell>{r.contactName}</TableCell>
												<TableCell className="text-muted-foreground">
													{r.dealTitle}
												</TableCell>
												<TableCell>{messengerLabel(r.messenger)}</TableCell>
												<TableCell>
													<div className="flex flex-col gap-0.5">
														<Badge variant={badge.variant}>{badge.label}</Badge>
														{r.error && (
															<span
																className={`text-xs ${r.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
															>
																{r.error}
															</span>
														)}
													</div>
												</TableCell>
												{report.dryRun && (
													<TableCell className="text-right">
														{r.messenger && r.userId ? (
															<div className="flex flex-col items-end gap-0.5">
																<Button
																	variant="outline"
																	size="sm"
																	disabled={
																		!message.trim() || testingId !== null
																	}
																	onClick={() => setTestCandidate(r)}
																>
																	{testingId === r.contactId
																		? "Отправка…"
																		: "Тест"}
																</Button>
																{test &&
																	(test.ok ? (
																		<span className="text-xs text-muted-foreground">
																			Тест отправлен
																		</span>
																	) : (
																		<span className="text-xs text-destructive">
																			{test.error ?? "Ошибка теста"}
																		</span>
																	))}
															</div>
														) : null}
													</TableCell>
												)}
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						)}

						{pageCount > 1 && (
							<div className="flex items-center justify-between">
								<span className="text-sm text-muted-foreground">
									{currentPage * PAGE_SIZE + 1}–
									{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} из{" "}
									{filtered.length}
								</span>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										disabled={currentPage === 0}
										onClick={() => setPage(currentPage - 1)}
									>
										Назад
									</Button>
									<span className="text-sm text-muted-foreground self-center">
										{currentPage + 1} / {pageCount}
									</span>
									<Button
										variant="outline"
										size="sm"
										disabled={currentPage >= pageCount - 1}
										onClick={() => setPage(currentPage + 1)}
									>
										Вперёд
									</Button>
								</div>
							</div>
						)}
					</>
				)}

				<AlertDialog
					open={testCandidate !== null}
					onOpenChange={(open) => {
						if (!open) setTestCandidate(null);
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Отправить тестовое сообщение?</AlertDialogTitle>
							<AlertDialogDescription>
								Текущий текст сообщения получит один контакт «
								{testCandidate?.contactName}» в{" "}
								{messengerLabel(testCandidate?.messenger ?? null)}. Это реальное
								сообщение реальному человеку — остальные получатели ничего не
								получат.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Отмена</AlertDialogCancel>
							<AlertDialogAction onClick={confirmTest}>
								Отправить тест
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</CardContent>
		</Card>
	);
}
