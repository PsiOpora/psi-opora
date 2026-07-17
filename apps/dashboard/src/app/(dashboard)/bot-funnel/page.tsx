import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchBotFunnelEvents,
  funnelByMessenger,
  funnelBySourceCampaign,
  funnelStepStats,
  type BotFunnelStepStats,
} from "@/lib/analytics/bot-funnel";
import { parseDateRange } from "@/lib/analytics/date-range";
import { isRedisConfigured } from "@/lib/redis";
import { formatNumber, formatPercent } from "@/lib/format";
import { ExportCsvButton } from "@/components/dashboard/export-csv-button";
import { FunnelChart } from "@/components/dashboard/funnel-chart";

const MESSENGER_LABELS: Record<string, string> = {
  telegram: "Telegram",
  max: "MAX",
  all: "Все мессенджеры",
};

export default async function BotFunnelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = parseDateRange(await searchParams);
  const events = await fetchBotFunnelEvents(range);

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Воронка бота</CardTitle>
          <CardDescription>
            {isRedisConfigured()
              ? "За выбранный период событий нет. Счётчики шагов начинают накапливаться после деплоя ботов с трекингом — исторические данные до этого момента недоступны."
              : "Хранилище событий недоступно: переменные KV_REST_API_URL и KV_REST_API_TOKEN не заданы. На проде (Vercel) они настроены — локально страница работает только с подключённым Redis."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const steps = funnelStepStats(events);
  const byMessenger = funnelByMessenger(events);
  const bySource = funnelBySourceCampaign(events);

  const messengerTabs: Array<{
    value: string;
    label: string;
    data: BotFunnelStepStats[];
  }> = [
    { value: "all", label: "Все мессенджеры", data: steps },
    ...byMessenger.map(({ messenger, steps: ms }) => ({
      value: messenger,
      label: MESSENGER_LABELS[messenger] ?? messenger,
      data: ms,
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Воронка бота</CardTitle>
          <CardDescription>
            Путь пользователя от запуска бота до заявки в CRM за выбранный
            период
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all" className="w-full">
            <TabsList className="mb-5">
              {messengerTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {messengerTabs.map((tab) => (
              <TabsContent key={tab.value} value={tab.value}>
                <FunnelChart steps={tab.data} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>По источникам и кампаниям</CardTitle>
              <CardDescription className="mt-1">
                Параметры из deep-link бота
                (?start=utm_source=…&amp;utm_campaign=…) — где теряются лиды до
                попадания в CRM
              </CardDescription>
            </div>
            <CardAction>
              <ExportCsvButton
                filename="bot-funnel-sources.csv"
                headers={[
                  "Источник",
                  "Кампания",
                  "Стартов",
                  "Выбрали категорию",
                  "Телефонов",
                  "Заявок",
                  "Конверсия, %",
                ]}
                rows={bySource.map((row) => [
                  row.source,
                  row.campaign,
                  row.starts,
                  row.clicks,
                  row.phones,
                  row.deals,
                  (row.conversion * 100).toFixed(1),
                ])}
              />
            </CardAction>
          </div>
        </CardHeader>
        <CardContent>
          <SourceTable rows={bySource} />
        </CardContent>
      </Card>
    </div>
  );
}

function SourceTable({
  rows,
}: {
  rows: ReturnType<typeof funnelBySourceCampaign>;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        Нет данных по источникам за этот период.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Источник</TableHead>
            <TableHead>Кампания</TableHead>
            <TableHead className="text-right">Стартов</TableHead>
            <TableHead className="text-right">Категория</TableHead>
            <TableHead className="text-right">Телефонов</TableHead>
            <TableHead className="text-right">Заявок</TableHead>
            <TableHead className="text-right">Конверсия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-medium">{row.source}</TableCell>
              <TableCell className="text-muted-foreground">
                {row.campaign}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.starts)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.clicks)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.phones)}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {formatNumber(row.deals)}
              </TableCell>
              <TableCell className="text-right">
                <Badge
                  variant="secondary"
                  className={
                    row.conversion >= 0.05
                      ? "bg-emerald-100 text-emerald-700"
                      : undefined
                  }
                >
                  {formatPercent(row.conversion)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
