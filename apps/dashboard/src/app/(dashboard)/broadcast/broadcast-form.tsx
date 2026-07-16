"use client";

import { BoldIcon, CodeIcon, ItalicIcon, LinkIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
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
import {
  LARGE_AUDIENCE_THRESHOLD,
  MESSAGE_MAX_LENGTH,
} from "@/lib/broadcast/constants";
import type {
  BroadcastChannel,
  BroadcastRecipient,
  BroadcastReport,
} from "@/lib/broadcast/send";
import {
  type RecentBroadcastInfo,
  sendBroadcastAction,
  sendTestMessageAction,
} from "./actions";
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

const STATUS_BADGE: Record<
  BroadcastRecipient["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
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
  message,
}: {
  report: BroadcastReport;
  message: string;
}) {
  const [messengerFilter, setMessengerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {},
  );
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testCandidate, setTestCandidate] =
    useState<BroadcastRecipient | null>(null);
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
      const result = await sendTestMessageAction({ messenger, userId, message });
      setTestResults((prev) => ({ ...prev, [contactId]: result }));
      setTestingId(null);
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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

            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Никто не подходит под выбранные фильтры.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
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
                {messengerLabel(testCandidate?.messenger ?? null)}. Это
                реальное сообщение реальному человеку — остальные получатели
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

export function BroadcastForm({ stages }: { stages: StageOption[] }) {
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
  const [queued, setQueued] = useState<{
    broadcastId: string;
    count: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const messageRef = useRef<HTMLTextAreaElement>(null);

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
  const previewFresh =
    report?.dryRun && previewSig === currentSig;
  const sendableCount = report
    ? report.recipients.filter((r) => r.status === "pending").length
    : 0;
  const canSend =
    previewFresh && sendableCount > 0 && trimmed.length > 0 && !overLimit;

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

  // Оборачивает выделенный текст в разметку Telegram (легаси-Markdown,
  // тот же режим используют боты проекта: *…*, _…_, `…`, [текст](url))
  const applyFormat = (kind: "bold" | "italic" | "code" | "link") => {
    const el = messageRef.current;
    if (!el) return;
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const selected = message.slice(start, end);

    let inserted: string;
    let selectFrom: number;
    let selectTo: number;
    if (kind === "link") {
      const label = selected || "текст ссылки";
      const url = "https://";
      inserted = `[${label}](${url})`;
      // выделяем URL-заглушку, чтобы сразу вписать адрес
      selectFrom = start + label.length + 3;
      selectTo = selectFrom + url.length;
    } else {
      const marker = kind === "bold" ? "*" : kind === "italic" ? "_" : "`";
      const label =
        selected ||
        (kind === "bold" ? "жирный" : kind === "italic" ? "курсив" : "код");
      inserted = `${marker}${label}${marker}`;
      selectFrom = start + 1;
      selectTo = selectFrom + label.length;
    }

    setMessage(message.slice(0, start) + inserted + message.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectFrom, selectTo);
    });
  };

  const runPreview = () => {
    setConfirming(false);
    setAckChecked(false);
    setQueued(null);
    startTransition(async () => {
      setError(null);
      const result = await sendBroadcastAction({
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
      const result = await sendBroadcastAction({
        stageId,
        stageName: stageLabel,
        channel,
        message,
        dryRun: false,
        expectedRecipients,
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
            раз, даже если сделок у контакта несколько. Отправка возможна
            только после предпросмотра списка получателей.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Стадия сделки
              </Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger>
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
                <SelectTrigger>
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
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="message"
                  className="text-xs text-muted-foreground"
                >
                  Текст сообщения
                </Label>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Жирный — *текст*"
                    onClick={() => applyFormat("bold")}
                  >
                    <BoldIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Курсив — _текст_"
                    onClick={() => applyFormat("italic")}
                  >
                    <ItalicIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Моноширинный — `текст`"
                    onClick={() => applyFormat("code")}
                  >
                    <CodeIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Ссылка — [текст](https://…)"
                    onClick={() => applyFormat("link")}
                  >
                    <LinkIcon className="size-4" />
                  </Button>
                </div>
              </div>
              <textarea
                id="message"
                ref={messageRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={8}
                placeholder="Здравствуйте! Напоминаем о записи на консультацию…"
                className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full flex-1 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span
                className={`text-xs ${overLimit ? "text-destructive" : "text-muted-foreground"}`}
              >
                {trimmed.length} / {MESSAGE_MAX_LENGTH}
                {overLimit &&
                  " — мессенджеры не примут такое длинное сообщение"}
              </span>
              <p className="text-xs text-muted-foreground">
                Разметка Telegram: *жирный* _курсив_ `код`{" "}
                [ссылка](https://…). MAX получит то же форматирование.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Как увидит клиент в Telegram
              </Label>
              <TelegramPreview text={message} />
            </div>
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
                <span className="text-muted-foreground">Канал:</span>{" "}
                {CHANNEL_LABEL[channel]}
              </p>
              <p>
                <span className="text-muted-foreground">Получат сообщение:</span>{" "}
                {sendableCount} контактов
                {report.skipped > 0 &&
                  ` (ещё ${report.skipped} будут пропущены — нет мессенджера)`}
              </p>
            </div>

            {recentBroadcast && (
              <WarningBox>
                По этой стадии уже была рассылка{" "}
                {formatDateTime(recentBroadcast.startedAt)} (отправлено:{" "}
                {recentBroadcast.sentCount}). Убедитесь, что не отправляете
                то же самое повторно.
              </WarningBox>
            )}
            {sendableCount > LARGE_AUDIENCE_THRESHOLD && (
              <WarningBox>
                Большая аудитория: {sendableCount} получателей. Отправка займёт
                несколько минут, не закрывайте страницу. Рекомендуем сначала
                отправить тест себе кнопкой «Тест» в предпросмотре.
              </WarningBox>
            )}

            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                Сообщение, которое получат клиенты:
              </p>
              <TelegramPreview text={trimmed} />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ackChecked}
                onChange={(e) => setAckChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Я проверил(а) список получателей и текст сообщения. Понимаю,
                что сообщение уйдёт реальным клиентам.
              </span>
            </label>

            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={!ackChecked || isPending}
                onClick={runSend}
              >
                {isPending
                  ? "Отправка…"
                  : `Отправить ${sendableCount} сообщений`}
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
        <RecipientsReport key={reportKey} report={report} message={message} />
      )}
    </div>
  );
}
