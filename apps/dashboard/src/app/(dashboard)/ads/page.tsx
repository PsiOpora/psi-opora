import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAdStats, getCachedAdStats, type AdStatsResult } from "@/lib/marketing/ads-api";
import { getRedisOrNull } from "@/lib/redis";
import { formatMoney, formatNumber } from "@/lib/format";
import { AdRefreshButton } from "./refresh-button";
import { AdStatsError } from "@/components/dashboard/ad-stats-error";

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

  let data: AdStatsResult | null = null;
  let loadError = false;

  if (redis) {
    data = await getCachedAdStats(redis);
  }

  if (!data) {
    try {
      data = await fetchAdStats(redis);
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

  return <AdsContent data={data!} redis={redis} />;
}

async function AdsContent({ data, redis }: { data: AdStatsResult; redis: ReturnType<typeof getRedisOrNull> }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Рекламные кампании</h1>
          <p className="text-sm text-muted-foreground">
            Live-данные из Яндекс.Директ и VK Ads
            {data.lastUpdated && ` · обновлено ${new Date(data.lastUpdated).toLocaleString("ru-RU")}`}
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
            <div className="text-2xl font-bold">{formatMoney(data.totalSpend)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Показы</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(data.totalImpressions)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Клики</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(data.totalClicks)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Кампании</CardTitle>
          <CardDescription>Данные за последние 7 дней. Кеш хранится 1 час.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.campaigns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Нет активных кампаний или не настроены API-ключи
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
                {data.campaigns.map((c) => (
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
