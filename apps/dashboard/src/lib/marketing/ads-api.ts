import type { RedisClient } from "@/lib/redis";
import { getAdCredentials, upsertAdDailyStats, type NewAdDailyStats } from "@psi-opora/db/queries";

const API_URL = "https://api.vk.com/method";

export interface VkCampaign {
  id: number;
  name: string;
  status: number;
  all_impressions: string;
  all_clicks: string;
  day_budget: string;
  start_time: string;
}

export interface VkDailyStats {
  day: string;
  impressions: number;
  clicks: number;
  spend: number;
}

export interface VkCampaignStats {
  stats: VkDailyStats[];
}

interface VkApiResponse {
  response?: unknown;
  error?: {
    error_code: number;
    error_msg: string;
  };
}

async function vkRequest<T>(
  method: string,
  params: Record<string, string | number>,
  accessToken: string,
): Promise<T> {
  const url = new URL(`${API_URL}/${method}`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("v", "5.131");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`VK API error: ${res.status}`);

  const json = (await res.json()) as VkApiResponse;
  if (json.error) throw new Error(`VK error ${json.error.error_code}: ${json.error.error_msg}`);
  return json.response as T;
}

async function getVkCampaigns(accountId: string, accessToken: string): Promise<VkCampaign[]> {
  const data = await vkRequest<{ items: VkCampaign[] }>(
    "ads.getCampaigns",
    { account_id: Number(accountId) },
    accessToken,
  );
  return data.items ?? [];
}

async function getVkStats(
  accountId: string,
  accessToken: string,
  campaignIds: number[],
  dateFrom: string,
  dateTo: string,
): Promise<Map<number, VkCampaignStats>> {
  const results = new Map<number, VkCampaignStats>();
  for (const id of campaignIds) {
    try {
      const data = await vkRequest<{ items: VkCampaignStats[] }>(
        "ads.getStatistics",
        {
          account_id: Number(accountId),
          ids_type: "campaign",
          ids: String(id),
          period: 1,
          date_from: dateFrom,
          date_to: dateTo,
        },
        accessToken,
      );
      if (data.items?.[0]) results.set(id, data.items[0]);
    } catch {
      // skip failed campaigns
    }
  }
  return results;
}

const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
const YANDEX_API_URL = "https://api.direct.yandex.com/json/v5";

interface YandexTokenResponse {
  access_token: string;
  expires_in: number;
}

interface YandexApiResponse {
  data?: unknown;
  error_code?: number;
  error_detail?: string;
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getYandexToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(YANDEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Yandex token error: ${res.status}`);

  const data = (await res.json()) as YandexTokenResponse;
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function yandexRequest<T>(
  method: string,
  body: Record<string, unknown>,
  token: string,
): Promise<T> {
  const res = await fetch(`${YANDEX_API_URL}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Yandex API error: ${res.status}`);

  const json = (await res.json()) as YandexApiResponse;
  if (json.error_code) throw new Error(`Yandex error ${json.error_code}: ${json.error_detail}`);
  return json.data as T;
}

export interface YandexCampaign {
  Id: number;
  Name: string;
  Status: "RUNNING" | "SUSPENDED" | "ARCHIVED" | "CONVERTED";
  Type: string;
}

export interface YandexReportRow {
  CampaignId: number;
  CampaignName: string;
  Impressions: number;
  Clicks: number;
  Cost: number;
  Date: string;
}

async function getYandexCampaigns(token: string): Promise<YandexCampaign[]> {
  const data = await yandexRequest<{ Campaigns: YandexCampaign[] }>(
    "campaigns",
    {
      method: "GetCampaigns",
      params: {
        SelectionCriteria: {},
        FieldNames: ["Id", "Name", "Status", "Type"],
      },
    },
    token,
  );
  return data.Campaigns ?? [];
}

async function getYandexReport(
  token: string,
  campaignIds: number[],
  dateFrom: string,
  dateTo: string,
): Promise<YandexReportRow[]> {
  const data = await yandexRequest<{ Rows: YandexReportRow[] }>(
    "reports",
    {
      reportType: "CAMPAIGN_PERFORMANCE_REPORT",
      dateRangeType: "CUSTOM_DATE",
      params: {
        SelectionCriteria: { CampaignIds: campaignIds, DateFrom: dateFrom, DateTo: dateTo },
        Columns: ["CampaignId", "CampaignName", "Impressions", "Clicks", "Cost"],
      },
    },
    token,
  );
  return data.Rows ?? [];
}

export interface AdCampaign {
  id: string;
  name: string;
  platform: "yandex" | "vk";
  status: string;
  impressions: number;
  clicks: number;
  spend: number;
  date: string;
}

export interface AdStatsResult {
  campaigns: AdCampaign[];
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  lastUpdated: string;
}

const CACHE_KEY = "ad_stats:live";
const CACHE_TTL = 3600;

export async function fetchAdStats(redis: RedisClient | null): Promise<AdStatsResult> {
  const today = new Date();
  const dateTo: string = today.toISOString().split("T")[0]!;
  const dateFrom: string = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;

  const campaigns: AdCampaign[] = [];
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  const dbRows: NewAdDailyStats[] = [];

  const creds = await getAdCredentials();

  if (creds?.yandexClientId && creds?.yandexClientSecret && creds?.yandexRefreshToken) {
    try {
      const token = await getYandexToken(
        creds.yandexClientId,
        creds.yandexClientSecret,
        creds.yandexRefreshToken,
      );
      const yandexCampaigns = await getYandexCampaigns(token);
      if (yandexCampaigns.length > 0) {
        const report = await getYandexReport(
          token,
          yandexCampaigns.map((c) => c.Id),
          dateFrom,
          dateTo,
        );
        for (const row of report) {
          totalSpend += row.Cost;
          totalImpressions += row.Impressions;
          totalClicks += row.Clicks;
          campaigns.push({
            id: `yandex_${row.CampaignId}`,
            name: row.CampaignName,
            platform: "yandex",
            status: yandexCampaigns.find((c) => c.Id === row.CampaignId)?.Status ?? "UNKNOWN",
            impressions: row.Impressions,
            clicks: row.Clicks,
            spend: row.Cost,
            date: row.Date,
          });
          dbRows.push({
            id: `yandex_${row.CampaignId}_${row.Date}`,
            platform: "yandex",
            campaignId: String(row.CampaignId),
            campaignName: row.CampaignName,
            date: row.Date,
            impressions: row.Impressions,
            clicks: row.Clicks,
            spend: Math.round(row.Cost * 100),
          });
        }
      }
    } catch (err) {
      console.warn("[ads] Yandex error:", (err as Error).message);
    }
  }

  if (creds?.vkAccessToken && creds?.vkAdsAccountId) {
    try {
      const vkCampaigns = await getVkCampaigns(creds.vkAdsAccountId, creds.vkAccessToken);
      if (vkCampaigns.length > 0) {
        const stats = await getVkStats(
          creds.vkAdsAccountId,
          creds.vkAccessToken,
          vkCampaigns.map((c) => c.id),
          dateFrom,
          dateTo,
        );
        for (const campaign of vkCampaigns) {
          const s = stats.get(campaign.id);
          const impressions = s?.stats.reduce((sum, d) => sum + d.impressions, 0) ?? 0;
          const clicks = s?.stats.reduce((sum, d) => sum + d.clicks, 0) ?? 0;
          const spend = s?.stats.reduce((sum, d) => sum + d.spend, 0) ?? 0;
          totalSpend += spend;
          totalImpressions += impressions;
          totalClicks += clicks;
          campaigns.push({
            id: `vk_${campaign.id}`,
            name: campaign.name,
            platform: "vk",
            status: String(campaign.status),
            impressions,
            clicks,
            spend,
            date: dateTo,
          });
          dbRows.push({
            id: `vk_${campaign.id}_${dateTo}`,
            platform: "vk",
            campaignId: String(campaign.id),
            campaignName: campaign.name,
            date: dateTo,
            impressions,
            clicks,
            spend: Math.round(spend * 100),
          });
        }
      }
    } catch (err) {
      console.warn("[ads] VK error:", (err as Error).message);
    }
  }

  await upsertAdDailyStats(dbRows);

  const result: AdStatsResult = {
    campaigns,
    totalSpend,
    totalImpressions,
    totalClicks,
    lastUpdated: new Date().toISOString(),
  };

  if (redis) {
    await redis.set(CACHE_KEY, result, { ex: CACHE_TTL });
  }

  return result;
}

export async function getCachedAdStats(redis: RedisClient | null): Promise<AdStatsResult | null> {
  if (!redis) return null;
  return redis.get<AdStatsResult>(CACHE_KEY);
}
