"use client";

import type { UnisenderTemplate } from "@psi-opora/unisender-client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  EmailRecipient,
  EmailRecipientsReport,
  RecentEmailCampaignInfo,
} from "@psi-opora/api";
import { LARGE_AUDIENCE_THRESHOLD } from "@psi-opora/api/schemas";
import { orpcClient } from "@/lib/orpc/client";
import { emailCampaignsListKey } from "./history";

export interface StageOption {
  stageId: string;
  stageName: string;
  sort: number;
  categoryId: string;
  categoryName: string;
}

const STATUS_BADGE: Record<
  EmailRecipient["status"],
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  pending: { label: "Готов к отправке", variant: "secondary" },
  skipped: { label: "Пропущен", variant: "outline" },
};

const STATUS_FILTERS = [
  { value: "all", label: "Все статусы" },
  { value: "pending", label: "Готов к отправке" },
  { value: "skipped", label: "Пропущен" },
] as const;

const PAGE_SIZE = 20;

type TestResult = { ok: boolean; error?: string };

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
      ⚠️ {children}
    </div>
  );
}

function RecipientsReport({
  report,
  subject,
  templateId,
  selectedIds,
  onToggle,
  onToggleMany,
}: {
  report: EmailRecipientsReport;
  subject: string;
  templateId: string;
  selectedIds: Set<string>;
  onToggle: (contactId: string) => void;
  onToggleMany: (contactIds: string[], checked: boolean) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {},
  );
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testCandidate, setTestCandidate] = useState<EmailRecipient | null>(
    null,
  );
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return report.recipients.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (
        query &&
        !r.contactName.toLowerCase().includes(query) &&
        !r.dealTitle.toLowerCase().includes(query) &&
        !(r.email ?? "").toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [report.recipients, statusFilter, search]);

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
    if (!testCandidate?.email) return;
    const { email, contactId } = testCandidate;
    setTestingId(contactId);
    startTransition(async () => {
      const toastId = toast.loading("Отправляем тестовое письмо…");
      const result = await orpcClient.emailBroadcast.sendTest({
        email,
        templateId,
        subject,
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
          {report.recipients.length} · Без email или отписаны: {report.skipped}
          {report.dryRun &&
            " · Кнопка «Тест» отправляет письмо выбранного шаблона только выбранному контакту."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {report.recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            На выбранной стадии нет сделок с привязанными контактами.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(200px,2fr)_minmax(160px,1fr)]">
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Поиск по контакту, сделке или email…"
              />
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
                    ? `Отмечено получателей: ${selectedIds.size}. Письмо получат только они.`
                    : "Никто не отмечен — письмо получат все готовые к отправке."}
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
                    <TableHead>Email</TableHead>
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
                        <TableCell>{r.email ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            {r.error && (
                              <span className="text-xs text-muted-foreground">
                                {r.error}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        {report.dryRun && (
                          <TableCell className="text-right">
                            {r.email ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={
                                    !subject.trim() || testingId !== null
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
              <AlertDialogTitle>Отправить тестовое письмо?</AlertDialogTitle>
              <AlertDialogDescription>
                Письмо по выбранному шаблону получит один контакт «
                {testCandidate?.contactName}» на адрес {testCandidate?.email}.
                Это реальное письмо реальному человеку — остальные получатели
                ничего не получат.
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

export function EmailCampaignForm({
  stages,
  templates,
  senderConfigured,
}: {
  stages: StageOption[];
  templates: UnisenderTemplate[];
  senderConfigured: boolean;
}) {
  const queryClient = useQueryClient();
  const [stageId, setStageId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const subjectTouchedRef = useRef(false);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [report, setReport] = useState<EmailRecipientsReport | null>(null);
  const [recentCampaign, setRecentCampaign] =
    useState<RecentEmailCampaignInfo | null>(null);
  const [previewSig, setPreviewSig] = useState<string | null>(null);
  const [reportKey, setReportKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    new Set(),
  );
  const [queued, setQueued] = useState<{
    campaignId: string;
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
      if (!subjectTouchedRef.current && result.subject) setSubject(result.subject);
    });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const trimmedSubject = subject.trim();
  const currentSig = JSON.stringify([stageId, templateId, trimmedSubject]);
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
    previewFresh && sendableCount > 0 && trimmedSubject.length > 0;

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

  const sendHint = !senderConfigured
    ? "Не задан email отправителя — настройте на странице /settings/email."
    : !stageId
      ? "Выберите стадию сделки."
      : !templateId
        ? "Выберите шаблон письма."
        : !trimmedSubject
          ? "Введите тему письма."
          : !previewFresh
            ? report
              ? "Параметры изменились после предпросмотра — нажмите «Показать получателей» ещё раз."
              : "Отправка откроется после предпросмотра: нажмите «Показать получателей» и проверьте список."
            : sendableCount === 0
              ? "Среди получателей нет ни одного с email."
              : null;

  const runPreview = () => {
    setConfirming(false);
    setAckChecked(false);
    setQueued(null);
    setSelectedContactIds(new Set());
    startTransition(async () => {
      setError(null);
      const result = await orpcClient.emailBroadcast.send({
        stageId,
        stageName: stageLabel,
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
        stageId,
        stageName: stageLabel,
        templateId,
        templateName: selectedTemplate?.title,
        subject,
        dryRun: false,
        expectedRecipients,
        selectedContactIds:
          selectedContactIds.size > 0 ? [...selectedContactIds] : undefined,
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
        queryClient.invalidateQueries({ queryKey: emailCampaignsListKey });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Параметры рассылки</CardTitle>
          <CardDescription>
            Письмо получит контакт каждой сделки на выбранной стадии — один
            раз, даже если сделок у контакта несколько. Отправка возможна
            только после предпросмотра списка получателей.
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
              <Label className="text-xs text-muted-foreground">
                Шаблон Unisender
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
                disabled={!stageId || !templateId || isPending}
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subject" className="text-xs text-muted-foreground">
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
              {selectedTemplate?.screenshot_url && (
                <a
                  href={
                    selectedTemplate.fullsize_screenshot_url ??
                    selectedTemplate.screenshot_url
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground underline underline-offset-2 w-fit"
                >
                  Открыть миниатюру шаблона
                </a>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Как увидит клиент (превью шаблона)
              </Label>
              <div className="rounded-md border overflow-hidden bg-white h-64">
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
              Импорт {queued.count} получателей в Unisender и запуск кампании
              выполняются в фоне — страницу можно закрыть. Статус появится на
              странице рассылки.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/email-broadcast/${queued.campaignId}`}>
                Открыть статус рассылки
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {confirming && previewFresh && report && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle>Подтверждение отправки</CardTitle>
            <CardDescription>
              Проверьте всё ещё раз — отменить рассылку после запуска
              невозможно.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="text-sm">
              <p>
                <span className="text-muted-foreground">Стадия:</span>{" "}
                {stageLabel}
              </p>
              <p>
                <span className="text-muted-foreground">Шаблон:</span>{" "}
                {selectedTemplate?.title ?? templateId}
              </p>
              <p>
                <span className="text-muted-foreground">Тема:</span>{" "}
                {trimmedSubject}
              </p>
              <p>
                <span className="text-muted-foreground">
                  Получат письмо:
                </span>{" "}
                {sendableCount} контактов
                {selectedContactIds.size > 0
                  ? " (отмечены вручную, остальные пропущены)"
                  : ""}
                {report.skipped > 0 &&
                  ` (ещё ${report.skipped} будут пропущены — нет email или отписаны)`}
              </p>
            </div>

            {recentCampaign && (
              <WarningBox>
                По этой стадии уже была email-рассылка{" "}
                {formatDateTime(recentCampaign.startedAt)} (получателей:{" "}
                {recentCampaign.recipientsCount ?? "—"}). Убедитесь, что не
                отправляете то же самое повторно.
              </WarningBox>
            )}
            {sendableCount > LARGE_AUDIENCE_THRESHOLD && (
              <WarningBox>
                Большая аудитория: {sendableCount} получателей. Рекомендуем
                сначала отправить тест себе кнопкой «Тест» в предпросмотре.
              </WarningBox>
            )}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ackChecked}
                onChange={(e) => setAckChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Я проверил(а) список получателей, тему и шаблон письма. Понимаю,
                что письмо уйдёт реальным клиентам через Unisender.
              </span>
            </label>

            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={!ackChecked || isPending}
                onClick={runSend}
              >
                {isPending ? "Отправка…" : `Отправить ${sendableCount} писем`}
              </Button>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setConfirming(false);
                  setAckChecked(false);
                }}
              >
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {report && (
        <RecipientsReport
          key={reportKey}
          report={report}
          subject={trimmedSubject}
          templateId={templateId}
          selectedIds={selectedContactIds}
          onToggle={toggleContact}
          onToggleMany={toggleManyContacts}
        />
      )}
    </div>
  );
}
