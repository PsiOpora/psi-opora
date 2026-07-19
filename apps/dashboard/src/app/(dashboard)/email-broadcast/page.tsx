import { getUnisenderSettings } from "@psi-opora/db/queries";
import {
  createUnisenderClient,
  type UnisenderTemplate,
} from "@psi-opora/unisender-client";
import Link from "next/link";
import { NotConnected } from "@/components/dashboard/not-connected";
import { fetchCategoryNames, fetchStageNames } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { EmailCampaignForm, type StageOption } from "./email-campaign-form";
import { EmailCampaignHistory } from "./history";

/** CATEGORY_ID из STAGE_ID: "C5:NEW" → "5", "NEW" (основная воронка) → "0". */
function categoryOfStage(stageId: string): string {
  return stageId.match(/^C(\d+):/)?.[1] ?? "0";
}

export default async function EmailBroadcastPage() {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const [stages, categories, settings] = await Promise.all([
    fetchStageNames(api),
    fetchCategoryNames(api).catch(() => new Map<string, string>()),
    getUnisenderSettings().catch(() => null),
  ]);

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

  let templates: UnisenderTemplate[] = [];
  let templatesError: string | null = null;
  if (settings?.apiKey) {
    try {
      templates = await createUnisenderClient(settings.apiKey).getTemplates();
    } catch (err) {
      templatesError = (err as Error).message;
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Email-рассылка</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Письмо по шаблону Unisender контактам сделок выбранной стадии.
          Рассылку и unsubscribe-ссылку обрабатывает Unisender.
        </p>
      </div>

      {!settings?.apiKey ? (
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
          senderConfigured={!!settings.senderEmail}
        />
      )}

      <EmailCampaignHistory />
    </div>
  );
}
