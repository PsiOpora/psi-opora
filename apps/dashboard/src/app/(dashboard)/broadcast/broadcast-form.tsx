"use client";

import { useMemo, useState, useTransition } from "react";
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
import type {
  BroadcastChannel,
  BroadcastRecipient,
  BroadcastReport,
} from "@/lib/broadcast/send";
import { sendBroadcastAction, sendTestMessageAction } from "./actions";

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

  const sendTest = (recipient: BroadcastRecipient) => {
    if (!recipient.messenger || !recipient.userId) return;
    if (
      !window.confirm(
        `Отправить тестовое сообщение контакту «${recipient.contactName}» в ${messengerLabel(recipient.messenger)}?`,
      )
    ) {
      return;
    }
    const { messenger, userId, contactId } = recipient;
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
                            {r.error && r.status === "error" && (
                              <span className="text-xs text-destructive">
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
                                  onClick={() => sendTest(r)}
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
      </CardContent>
    </Card>
  );
}

export function BroadcastForm({ stages }: { stages: StageOption[] }) {
  const [stageId, setStageId] = useState("");
  const [channel, setChannel] = useState<BroadcastChannel>("auto");
  const [message, setMessage] = useState("");
  const [report, setReport] = useState<BroadcastReport | null>(null);
  const [reportKey, setReportKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categories = new Map<string, StageOption[]>();
  for (const stage of stages) {
    const list = categories.get(stage.categoryName) ?? [];
    list.push(stage);
    categories.set(stage.categoryName, list);
  }

  const run = (dryRun: boolean) => {
    if (
      !dryRun &&
      !window.confirm(
        "Отправить рассылку? Сообщения уйдут реальным клиентам, отменить будет нельзя.",
      )
    ) {
      return;
    }
    const stage = stages.find((s) => s.stageId === stageId);
    startTransition(async () => {
      setError(null);
      const result = await sendBroadcastAction({
        stageId,
        stageName: stage
          ? `${stage.categoryName} — ${stage.stageName}`
          : undefined,
        channel,
        message,
        dryRun,
      });
      if (result.error) {
        setError(result.error);
        setReport(null);
      } else {
        setReport(result.report ?? null);
        setReportKey((k) => k + 1);
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
            раз, даже если сделок у контакта несколько.
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="message" className="text-xs text-muted-foreground">
              Текст сообщения
            </Label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="Здравствуйте! Напоминаем о записи на консультацию…"
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!stageId || isPending}
              onClick={() => run(true)}
            >
              {isPending ? "Загрузка…" : "Показать получателей"}
            </Button>
            <Button
              disabled={!stageId || !message.trim() || isPending}
              onClick={() => run(false)}
            >
              {isPending ? "Отправка…" : "Отправить рассылку"}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {report && (
        <RecipientsReport key={reportKey} report={report} message={message} />
      )}
    </div>
  );
}
