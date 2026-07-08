import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAdStats, getCachedAdStats, type AdStatsResult } from "@/lib/marketing/ads-api";
import { getRedisOrNull } from "@/lib/redis";
import { formatMoney, formatNumber } from "@/lib/format";
import { AdRefreshButton } from "./refresh-button";
import { AdStatsError } from "@/components/dashboard/ad-stats-error";
import { AdTrendChart } from "./trend-chart";
import { orpc } from "@/lib/orpc-client";

function formatCtr(clicks: number, impressions: number): string {
  if (impressions === 0) return "—";
  return ((clicks / impressions) * 100).toFixed(2) + "%";
}

function StatusBadge({ status, platform }: { status: string; platform: string }) {
  const isActive = status === "RUNNING" || status === "1";
  const label = isActive ? "Активна" : status === "SUSPENDED" || status === "0" ? "Приостановлена" : status;
  return (
    <Badge variant={isActive ? "default" : "secondary"}>
      {platform === "vk" ? "🔵" : "🔴"} {label}
    </Badge>
  );
}

export default async function AdsPage() {
  const redis = getRedisOrNull();
  const today = new Date();
  const dateTo = today.toISOString().split("T")[0]!;
  const dateFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

  let data: AdStatsResult | null = null;
  let loadError = false;

  if (redis) {
    data = await getCachedAdStats(redis);
  }

  if (!data) {
    try {
      const creds = await orpc.ads.getCredentials().catch(() => null);
      data = await fetchAdStats(redis, creds);
    } catch (err) {
      loadError = true;
    }
  }

  if (loadError || (!data && !redis)) {
    return (
      <AdStatsError
        message={
          !redis
            ? "Redis не настроен. Настройте KV_REST_API_URL и KV_REST_API_TOKEN."
            : "Не удалось загрузить данные. Проверьте API-ключи."
        }
      />
    );
  }

  // data is guaranteed non-null here — we returned early if both loadError and redis are falsy
  const liveData = data!;

  const dbStats = await orpc.ads.stats({ dateFrom, dateTo }).catch(() => ({
    summary: { totalSpend: 0, totalImpressions: 0, totalClicks: 0 },
    rows: [],
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Рекламные кампании</h1>
          <p className="text-sm text-muted-foreground">
            Данные из Яндекс.Директ и VK Ads
            {liveData.lastUpdated && ` · обновлено ${new Date(liveData.lastUpdated).toLocaleString("ru-RU")}`}
          </p>
        </div>
        <AdRefreshButton />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Расход за 7 дней</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(liveData.totalSpend)}</div>
            {dbStats.summary.totalSpend > 0 && dbStats.summary.totalSpend !== liveData.totalSpend && (
              <p className="text-xs text-muted-foreground mt-1">
                БД: {formatMoney(dbStats.summary.totalSpend)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Показы</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(liveData.totalImpressions)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Клики</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(liveData.totalClicks)}</div>
          </CardContent>
        </Card>
      </div>

      {dbStats.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Динамика за 7 дней</CardTitle>
            <CardDescription>Агрегированные данные из PostgreSQL</CardDescription>
          </CardHeader>
          <CardContent>
            <AdTrendChart rows={dbStats.rows} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Кампании</CardTitle>
          <CardDescription>Данные за последние 7 дней</CardDescription>
        </CardHeader>
        <CardContent>
          {liveData.campaigns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Нет активных кампаний или не настроены API-ключи.{" "}
              <a href="/settings/ads" className="underline underline-offset-2">
                Настроить
              </a>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Кампания</TableHead>
                  <TableHead>Платформа</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Показы</TableHead>
                  <TableHead className="text-right">Клики</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Расход</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveData.campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.platform === "vk" ? "VK Ads" : "Яндекс.Директ"}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} platform={c.platform} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.impressions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.clicks)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCtr(c.clicks, c.impressions)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatMoney(c.spend)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
