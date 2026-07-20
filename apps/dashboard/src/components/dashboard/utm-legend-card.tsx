"use client";

import { ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { UTM_TAGS } from "@/lib/analytics/utm-tags";

export function UtmLegendCard() {
  return (
    <Collapsible className="group/utm-legend">
      <Card>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="block w-full cursor-pointer rounded-t-xl text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                Что означают UTM-метки
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/utm-legend:rotate-180" />
              </CardTitle>
              <CardDescription>
                Нажмите, чтобы посмотреть расшифровку каждой метки и примеры
                значений.
              </CardDescription>
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              UTM-метки — параметры в ссылке рекламного объявления или
              рассылки. Когда клиент переходит по такой ссылке, Битрикс24
              сохраняет их в карточке сделки. Значение «(не указано)»
              означает, что сделка пришла без меток — например, прямой заход
              на сайт или звонок.
            </p>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {UTM_TAGS.map((item) => (
                <div
                  key={item.tag}
                  className="flex flex-col gap-1 rounded-lg bg-muted/40 p-3"
                >
                  <dt className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium">
                    <span className="font-mono text-foreground">
                      {item.tag}
                    </span>
                    <span className="text-muted-foreground">
                      — {item.title}
                    </span>
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
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
