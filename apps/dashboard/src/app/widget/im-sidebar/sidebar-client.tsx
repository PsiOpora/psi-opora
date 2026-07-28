"use client";

import type { CrmLinksResult } from "@psi-opora/api";
import {
  BriefcaseBusinessIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  UserRoundIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useB24Frame } from "@/components/bitrix/frame-provider";
import { orpcClient } from "@/lib/orpc/client";

function formatOpportunity(
  opportunity: string | null,
  currencyId: string | null,
): string | null {
  if (!opportunity) return null;
  const value = Number.parseFloat(opportunity);
  if (!Number.isFinite(value) || value === 0) return null;
  const currency = currencyId === "RUB" ? "₽" : (currencyId ?? "");
  return `${value.toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
  })} ${currency}`.trim();
}

function EntityLink({
  url,
  children,
}: {
  url: string | null;
  children: React.ReactNode;
}) {
  if (!url) return <span>{children}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {children}
      <ExternalLinkIcon className="size-3.5 shrink-0" />
    </a>
  );
}

export function ImSidebarCrm({ dialogId }: { dialogId: string }) {
  const { b24 } = useB24Frame();
  const [data, setData] = useState<CrmLinksResult | null>(null);
  const [loading, setLoading] = useState(true);
  const placementOptions = b24?.placement.options as
    | { dialogId?: string; DIALOG_ID?: string }
    | undefined;
  const effectiveDialogId =
    dialogId || placementOptions?.dialogId || placementOptions?.DIALOG_ID || "";

  const load = useCallback(async () => {
    if (!effectiveDialogId) {
      setData({
        contact: null,
        lead: null,
        deals: [],
        error: "Битрикс24 не передал ID текущего диалога",
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(
        await orpcClient.messages.crmLinksByDialog({
          dialogId: effectiveDialogId,
        }),
      );
    } catch (err) {
      setData({
        contact: null,
        lead: null,
        deals: [],
        error: (err as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, [effectiveDialogId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Ищем клиента в CRM…
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="flex flex-col items-start gap-3 py-2">
        <p className="text-sm text-muted-foreground">
          {data?.error ?? "CRM-данные чата недоступны"}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={load}>
          <RefreshCwIcon className="size-4" />
          Повторить
        </Button>
      </div>
    );
  }

  const isEmpty = !data.contact && !data.lead && data.deals.length === 0;
  if (isEmpty) {
    return (
      <div className="flex flex-col gap-2 py-2">
        <p className="text-sm font-medium">Клиент ещё не связан с CRM</p>
        <p className="text-xs text-muted-foreground">
          Контакт и сделка появятся здесь после завершения клиентом сценария
          бота.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">CRM</p>
          <p className="text-xs text-muted-foreground">Связи текущего чата</p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="Обновить данные"
          onClick={load}
        >
          <RefreshCwIcon className="size-4" />
        </Button>
      </div>

      {data.contact && (
        <div className="rounded-lg border p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserRoundIcon className="size-3.5" />
            Контакт
          </div>
          <EntityLink url={data.contact.url}>{data.contact.name}</EntityLink>
        </div>
      )}

      {data.lead && (
        <div className="rounded-lg border p-3">
          <div className="mb-1 text-xs text-muted-foreground">Лид</div>
          <EntityLink url={data.lead.url}>{data.lead.title}</EntityLink>
        </div>
      )}

      {data.deals.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BriefcaseBusinessIcon className="size-3.5" />
            Сделки ({data.deals.length})
          </div>
          {data.deals.map((deal) => {
            const money = formatOpportunity(deal.opportunity, deal.currencyId);
            return (
              <div key={deal.id} className="rounded-lg border p-3">
                <EntityLink url={deal.url}>{deal.title}</EntityLink>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {deal.stageName && (
                    <Badge
                      variant={deal.closed ? "outline" : "secondary"}
                      className="text-[10px]"
                    >
                      {deal.stageName}
                    </Badge>
                  )}
                  {money && (
                    <span className="text-xs text-muted-foreground">
                      {money}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
