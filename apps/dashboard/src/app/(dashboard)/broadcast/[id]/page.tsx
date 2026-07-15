import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getBroadcast,
  listBroadcastRecipients,
} from "@psi-opora/db/queries";
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
import { ResendFailed } from "./resend-failed";

const CHANNEL_LABEL: Record<string, string> = {
  auto: "Авто (Telegram или MAX)",
  telegram: "Только Telegram",
  max: "Только MAX",
};

const STATUS_BADGE: Record<
  string,
  { label: string; variant: "default" | "destructive" | "outline" }
> = {
  sent: { label: "Отправлено", variant: "default" },
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

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
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
          {broadcast.totalDeals ?? "—"} · Отправлено: {broadcast.sentCount} ·
          Пропущено: {broadcast.skippedCount} · Ошибок: {broadcast.failedCount}
        </p>
        {broadcast.error && (
          <p className="text-sm text-destructive mt-1">{broadcast.error}</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Текст сообщения</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{broadcast.message}</p>
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
          {broadcast.failedCount > 0 && broadcast.status !== "running" && (
            <ResendFailed
              broadcastId={broadcast.id}
              failedCount={broadcast.failedCount}
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
                          {r.error && r.status === "error" && (
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
    </div>
  );
}
