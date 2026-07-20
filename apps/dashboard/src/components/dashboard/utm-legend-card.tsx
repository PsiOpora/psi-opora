import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UTM_TAGS } from "@/lib/analytics/utm-tags";

export function UtmLegendCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Что означают UTM-метки</CardTitle>
        <CardDescription>
          UTM-метки — параметры в ссылке рекламного объявления или рассылки.
          Когда клиент переходит по такой ссылке, Битрикс24 сохраняет их в
          карточке сделки. Значение «(не указано)» означает, что сделка
          пришла без меток — например, прямой заход на сайт или звонок.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {UTM_TAGS.map((item) => (
            <div
              key={item.tag}
              className="flex flex-col gap-1 rounded-lg bg-muted/40 p-3"
            >
              <dt className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium">
                <span className="font-mono text-foreground">{item.tag}</span>
                <span className="text-muted-foreground">— {item.title}</span>
              </dt>
              <dd className="text-sm text-muted-foreground">
                {item.description}
              </dd>
              <dd className="text-xs text-muted-foreground/80">
                Например: <span className="font-mono">{item.example}</span>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
