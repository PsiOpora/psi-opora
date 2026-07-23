"use client";

import type { Broadcast, BroadcastRecipientRow } from "@psi-opora/db/queries";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "../history";
import { TelegramPreview } from "../telegram-preview";
import { AutoRefresh } from "./auto-refresh";
import { broadcastDetailKey } from "./query-keys";
import { ResendFailed } from "./resend-failed";

const CHANNEL_LABEL: Record<string, string> = {
  auto: "Авто (Telegram или MAX)",
  telegram: "Только Telegram",
  max: "Только MAX",
};

const STATUS_BADGE: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  sent: { label: "Отправлено", variant: "default" },
  pending: { label: "В очереди", variant: "secondary" },
  skipped: { label: "Пропущен", variant: "outline" },
  error: { label: "Ошибка", variant: "destructive" },
};

export default function BroadcastDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data, isLoading, isError } = useQuery({
    queryKey: broadcastDetailKey(id),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/broadcasts/${id}`);
      if (!res.ok) throw new Error("Рассылка не найдена");
      return (await res.json()) as {
        broadcast: Broadcast;
        recipients: BroadcastRecipientRow[];
      };
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }
  if (isError || !data?.broadcast) {
    return <p className="text-sm text-destructive">Рассылка не найдена.</p>;
  }

  const { broadcast, recipients } = data;

  // Пока задача выполняется, счётчики в строке broadcasts ещё не обновлены —
  // считаем по фактическим статусам получателей.
  const counts = {
    sent: recipients.filter((r) => r.status === "sent").length,
    pending: recipients.filter((r) => r.status === "pending").length,
    skipped: recipients.filter((r) => r.status === "skipped").length,
    failed: recipients.filter((r) => r.status === "error").length,
  };
  const isRunning = broadcast.status === "running";

  return (
    <div className="flex w-full flex-col gap-6">
      <AutoRefresh enabled={isRunning} id={id} />
      <div>
        <Link
          href="/broadcast"
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          ← К рассылкам
        </Link>
        <h1 className="text-2xl font-semibold mt-2">
          Рассылка от {formatDateTime(broadcast.startedAt)}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {broadcast.stageName ?? broadcast.stageId} ·{" "}
          {CHANNEL_LABEL[broadcast.channel] ?? broadcast.channel} · Сделок:{" "}
          {broadcast.totalDeals ?? "—"} · Отправлено: {counts.sent}
          {counts.pending > 0 && ` · В очереди: ${counts.pending}`} · Пропущено:{" "}
          {counts.skipped} · Ошибок: {counts.failed}
        </p>
        {isRunning && (
          <p className="text-sm mt-1">
            ⏳ Рассылка выполняется в фоне — страница обновляется автоматически.
          </p>
        )}
        {broadcast.error && (
          <p className="text-sm text-destructive mt-1">{broadcast.error}</p>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(300px,400px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Текст сообщения</CardTitle>
          </CardHeader>
          <CardContent>
            <TelegramPreview text={broadcast.message} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Получатели</CardTitle>
            <CardDescription>
              Статус «Отправлено» означает, что мессенджер принял сообщение.
              Telegram и MAX не сообщают ботам о прочтении, поэтому статус
              «Просмотрено» недоступен.
            </CardDescription>
            {counts.failed > 0 && !isRunning && (
              <ResendFailed
                broadcastId={broadcast.id}
                failedCount={counts.failed}
              />
            )}
          </CardHeader>
          <CardContent>
            {recipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Получатели не сохранены.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Контакт</TableHead>
                    <TableHead>Сделка</TableHead>
                    <TableHead>Мессенджер</TableHead>
                    <TableHead>Отправлено</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.map((r) => {
                    const badge = STATUS_BADGE[r.status] ?? {
                      label: r.status,
                      variant: "outline" as const,
                    };
                    return (
                      <TableRow key={r.id}>
                        <TableCell>{r.contactName ?? r.contactId}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.dealTitle ?? r.dealId ?? "—"}
                        </TableCell>
                        <TableCell>
                          {r.messenger === "telegram"
                            ? "Telegram"
                            : r.messenger === "max"
                              ? "MAX"
                              : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(r.sentAt)}
                        </TableCell>
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
