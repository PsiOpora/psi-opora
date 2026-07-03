import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

const MESSENGER_LABELS: Record<string, string> = { telegram: "Telegram", max: "MAX" };

function StepBars({ steps }: { steps: BotFunnelStepStats[] }) {
  const max = Math.max(...steps.map((s) => s.count), 1);
  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, i) => (
        <div key={step.step} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{step.label}</span>
            <span className="whitespace-nowrap text-muted-foreground">
              {formatNumber(step.count)} · {formatPercent(step.shareOfStart)} от старта
              {i > 0 && ` · ${formatPercent(step.stepConversion)} с шага`}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max((step.count / max) * 100, step.count > 0 ? 2 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

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

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Воронка бота — все мессенджеры</CardTitle>
          <CardDescription>
            Путь пользователя от запуска бота до заявки в CRM за выбранный период
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StepBars steps={steps} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {byMessenger.map(({ messenger, steps: messengerSteps }) => (
          <Card key={messenger}>
            <CardHeader>
              <CardTitle>{MESSENGER_LABELS[messenger] ?? messenger}</CardTitle>
              <CardDescription>Воронка этого мессенджера</CardDescription>
            </CardHeader>
            <CardContent>
              <StepBars steps={messengerSteps} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>По источникам и кампаниям</CardTitle>
          <CardDescription>
            Параметры из deep-link бота (?start=utm_source=…&utm_campaign=…) — где теряются лиды до попадания в CRM
          </CardDescription>
          <CardAction>
            <ExportCsvButton
              filename="bot-funnel-sources.csv"
              headers={["Источник", "Кампания", "Стартов", "Нажали «Записаться»", "Телефонов", "Заявок", "Конверсия, %"]}
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
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Источник</TableHead>
                <TableHead>Кампания</TableHead>
                <TableHead className="text-right">Стартов</TableHead>
                <TableHead className="text-right">«Записаться»</TableHead>
                <TableHead className="text-right">Телефонов</TableHead>
                <TableHead className="text-right">Заявок</TableHead>
                <TableHead className="text-right">Старт → заявка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bySource.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{row.source}</TableCell>
                  <TableCell>{row.campaign}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.starts)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.clicks)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.phones)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.deals)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{formatPercent(row.conversion)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
