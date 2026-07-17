import Link from "next/link";
import { notFound } from "next/navigation";
import { getBroadcast, listBroadcastRecipients } from "@psi-opora/db/queries";
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

export default async function BroadcastDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [broadcast, recipients] = await Promise.all([
    getBroadcast(id),
    listBroadcastRecipients(id),
  ]);
  if (!broadcast) notFound();

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
      <AutoRefresh enabled={isRunning} />
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
