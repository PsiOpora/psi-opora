"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import { orpc } from "@/lib/orpc/client";
import { EmailCampaignForm, type StageOption } from "./email-campaign-form";
import { EmailCampaignHistory } from "./history";

/** CATEGORY_ID из STAGE_ID: "C5:NEW" → "5", "NEW" (основная воронка) → "0". */
function categoryOfStage(stageId: string): string {
  return stageId.match(/^C(\d+):/)?.[1] ?? "0";
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
  const { data: templates = [], isLoading: templatesLoading } = useQuery(
    orpc.emailTemplates.list.queryOptions(),
  );
  const { data: providerData, isLoading: providerLoading } = useQuery(
    orpc.email.getProvider.queryOptions(),
  );
  const { data: unisenderSettings, isLoading: unisenderSettingsLoading } =
    useQuery(orpc.email.getSettings.queryOptions());
  const { data: rusenderSettings, isLoading: rusenderSettingsLoading } =
    useQuery(orpc.email.getRusenderSettings.queryOptions());

  if (
    isLoading ||
    templatesLoading ||
    providerLoading ||
    unisenderSettingsLoading ||
    rusenderSettingsLoading
  ) {
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

  const senderConfigured = Boolean(
    providerData?.provider === "rusender"
      ? rusenderSettings?.senderEmail
      : unisenderSettings?.senderEmail,
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Email-рассылка</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Письмо по собственному шаблону контактам сделок выбранной стадии.
        </p>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Шаблонов писем ещё нет — создайте первый на странице{" "}
          <Link
            href="/email-templates/new"
            className="underline underline-offset-2"
          >
            Шаблоны писем
          </Link>
          .
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
