import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface AdDailyStats {
  date: string;
  platform: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
}

interface Props {
  rows: AdDailyStats[];
}

export function AdTrendChart({ rows }: Props) {
  const byDate = new Map<string, { date: string; yandexSpend: number; vkSpend: number; impressions: number; clicks: number }>();

  for (const row of rows) {
    const existing = byDate.get(row.date) ?? {
      date: row.date,
      yandexSpend: 0,
      vkSpend: 0,
      impressions: 0,
      clicks: 0,
    };
    if (row.platform === "yandex") existing.yandexSpend += Number(row.spend) / 100;
    else existing.vkSpend += Number(row.spend) / 100;
    existing.impressions += row.impressions ?? 0;
    existing.clicks += row.clicks ?? 0;
    byDate.set(row.date, existing);
  }

  const data = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Нет данных для графика</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => {
            const d = new Date(v + "T00:00:00");
            return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
          }}
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "var(--radius)",
            fontSize: 12,
          }}
          labelFormatter={(v) => {
            const d = new Date(String(v) + "T00:00:00");
            return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
          }}
          formatter={(value: unknown, name: unknown) => {
            const n = Number(value);
            if (name === "Расход") return [`${n.toLocaleString("ru-RU")} ₽`, String(name)];
            return [n.toLocaleString("ru-RU"), String(name)];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="yandexSpend"
          name="Яндекс.Директ"
          stroke="#E73C37"
          fill="#E73C37"
          fillOpacity={0.15}
        />
        <Area
          type="monotone"
          dataKey="vkSpend"
          name="VK Ads"
          stroke="#5181B8"
          fill="#5181B8"
          fillOpacity={0.15}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
