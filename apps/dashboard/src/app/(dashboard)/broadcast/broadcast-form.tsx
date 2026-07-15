"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
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
import { sendBroadcastAction } from "./actions";

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

export function BroadcastForm({ stages }: { stages: StageOption[] }) {
  const [stageId, setStageId] = useState("");
  const [channel, setChannel] = useState<BroadcastChannel>("auto");
  const [message, setMessage] = useState("");
  const [report, setReport] = useState<BroadcastReport | null>(null);
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
    startTransition(async () => {
      setError(null);
      const result = await sendBroadcastAction({
        stageId,
        channel,
        message,
        dryRun,
      });
      if (result.error) {
        setError(result.error);
        setReport(null);
      } else {
        setReport(result.report ?? null);
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
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.recipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                На выбранной стадии нет сделок с привязанными контактами.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Контакт</TableHead>
                    <TableHead>Сделка</TableHead>
                    <TableHead>Мессенджер</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.recipients.map((r) => {
                    const badge = STATUS_BADGE[r.status];
                    return (
                      <TableRow key={r.contactId}>
                        <TableCell>{r.contactName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.dealTitle}
                        </TableCell>
                        <TableCell>
                          {r.messenger === "telegram"
                            ? "Telegram"
                            : r.messenger === "max"
                              ? "MAX"
                              : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            {r.error && r.status !== "skipped" && (
                              <span className="text-xs text-destructive">
                                {r.error}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
