import { listEmailCampaigns } from "@psi-opora/db/queries";
import Link from "next/link";
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

export function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export async function EmailCampaignHistory() {
  const campaigns = await listEmailCampaigns();

  return (
    <Card>
      <CardHeader>
        <CardTitle>История email-рассылок</CardTitle>
        <CardDescription>
          Последние кампании; нажмите на строку, чтобы посмотреть получателей и
          статистику Unisender.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Рассылок ещё не было. История появится после первой отправки
            (требуется подключённая база данных).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Стадия</TableHead>
                <TableHead>Тема</TableHead>
                <TableHead className="text-right">Получателей</TableHead>
                <TableHead className="text-right">Отправлено</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap">
                    <Link
                      href={`/email-broadcast/${c.id}`}
                      className="underline underline-offset-2"
                    >
                      {formatDateTime(c.startedAt)}
                    </Link>
                  </TableCell>
                  <TableCell>{c.stageName ?? c.stageId}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {c.subject}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.recipientsCount ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.sentCount ?? "—"}
                  </TableCell>
                  <TableCell>
                    {c.status === "done" ? (
                      <Badge variant="default">Завершена</Badge>
                    ) : c.status === "error" ? (
                      <Badge variant="destructive">Ошибка</Badge>
                    ) : (
                      <Badge variant="secondary">Выполняется</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
