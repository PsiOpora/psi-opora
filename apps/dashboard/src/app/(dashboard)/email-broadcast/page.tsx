"use client";

import type { UnisenderTemplate } from "@psi-opora/unisender-client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import { EmailCampaignForm, type StageOption } from "./email-campaign-form";
import { EmailCampaignHistory } from "./history";

/** CATEGORY_ID из STAGE_ID: "C5:NEW" → "5", "NEW" (основная воронка) → "0". */
function categoryOfStage(stageId: string): string {
  return stageId.match(/^C(\d+):/)?.[1] ?? "0";
}

interface TemplatesResponse {
  configured: boolean;
  senderConfigured: boolean;
  templates: UnisenderTemplate[];
  error: string | null;
}

export default function EmailBroadcastPage() {
  return (
    <PageSuspense>
      <EmailBroadcastPageContent />
    </PageSuspense>
  );
}

function EmailBroadcastPageContent() {
  const { data, isLoading, isError } = useBitrixData([
    "stageNames",
    "categoryNames",
  ]);
  const { data: templatesData, isLoading: templatesLoading } =
    useQuery<TemplatesResponse>({
      queryKey: ["dashboard-email-broadcast-templates"],
      queryFn: async () => {
        const res = await fetch("/api/dashboard/email-broadcast/templates");
        if (!res.ok) throw new Error("Не удалось загрузить шаблоны Unisender");
        return res.json();
      },
    });

  if (isLoading || templatesLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Не удалось загрузить данные. Попробуйте обновить страницу.
      </p>
    );
  }
  if (!data?.connected) return <NotConnected />;

  const stages = data.stageNames ?? new Map();
  const categories = data.categoryNames ?? new Map();

  const options: StageOption[] = [...stages.entries()]
    .map(([stageId, info]) => {
      const categoryId = categoryOfStage(stageId);
      return {
        stageId,
        stageName: info.name,
        sort: info.sort,
        categoryId,
        categoryName:
          categories.get(categoryId) ??
          (categoryId === "0" ? "Основная воронка" : `Воронка ${categoryId}`),
      };
    })
    .sort(
      (a, b) =>
        a.categoryId.localeCompare(b.categoryId, undefined, {
          numeric: true,
        }) || a.sort - b.sort,
    );

  const templates = templatesData?.templates ?? [];
  const templatesError = templatesData?.error ?? null;
  const configured = templatesData?.configured ?? false;
  const senderConfigured = templatesData?.senderConfigured ?? false;

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Email-рассылка</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Письмо по шаблону Unisender контактам сделок выбранной стадии.
          Рассылку и unsubscribe-ссылку обрабатывает Unisender.
        </p>
      </div>

      {!configured ? (
        <p className="text-sm text-muted-foreground">
          Unisender не настроен. Укажите API-ключ на странице{" "}
          <Link
            href="/settings/email"
            className="underline underline-offset-2"
          >
            Настройки → Unisender
          </Link>
          .
        </p>
      ) : templatesError ? (
        <p className="text-sm text-destructive">
          Не удалось получить шаблоны Unisender: {templatesError}
        </p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          В аккаунте Unisender ещё нет ни одного шаблона письма — создайте его
          в личном кабинете Unisender.
        </p>
      ) : (
        <EmailCampaignForm
          stages={options}
          templates={templates}
          senderConfigured={senderConfigured}
        />
      )}

      <EmailCampaignHistory />
    </div>
  );
}
