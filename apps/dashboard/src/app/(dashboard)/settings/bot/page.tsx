import {
  GUIDE_FILE_S3_KEY,
  SCENARIO_TEXT_DEFS,
  type ScenarioTextDef,
} from "@psi-opora/bot-core";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { orpc } from "@/lib/orpc/server";
import { BotConnectorCard } from "./bot-connector-card";
import { BotTextsForm } from "./bot-texts-form";
import { CrmWidgetsCard } from "./crm-widgets-card";
import { DeleteGuideButton, SetActiveGuideButton } from "./guide-actions";
import { GuideUploadForm } from "./guide-upload-form";
import { TgPersonalConnectorCard } from "./tg-personal-connector-card";

function groupDefs(): Array<{ group: string; defs: ScenarioTextDef[] }> {
  const groups: Array<{ group: string; defs: ScenarioTextDef[] }> = [];
  for (const def of SCENARIO_TEXT_DEFS) {
    const existing = groups.find((g) => g.group === def.group);
    if (existing) existing.defs.push(def);
    else groups.push({ group: def.group, defs: [def] });
  }
  return groups;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function GuidesLibraryCard({
  guides,
  activeS3Key,
}: {
  guides: Array<{
    id: string;
    title: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    s3Key: string;
  }>;
  activeS3Key: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Гайды (PDF)</CardTitle>
        <CardDescription>
          Библиотека PDF-гайдов (лид-магнитов). Активный гайд бот шлёт после
          того, как клиент оставил email в ветке гайда, — вложением на почту
          (нужен RESEND_API_KEY) и, в MAX, дополнительно документом в чат
          (в Telegram — только по email). Остальные загруженные гайды хранятся
          про запас — под разные ветки сценария в будущем. Файлы — в S3
          (настройки из раздела «Бэкап CRM»), до 10 МБ каждый.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {guides.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Гайдов пока нет — бот отправит только текст гайда без вложения.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {guides.map((guide) => {
              const isActive = guide.s3Key === activeS3Key;
              return (
                <div
                  key={guide.id}
                  className="flex items-center justify-between gap-4 rounded-md border px-3 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <a
                        href={guide.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium underline underline-offset-2"
                      >
                        📎 {guide.title}
                      </a>
                      {isActive && (
                        <Badge className="text-[10px]">активен</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {guide.fileName} · {formatSize(guide.fileSize)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isActive && (
                      <SetActiveGuideButton id={guide.id} title={guide.title} />
                    )}
                    <DeleteGuideButton
                      id={guide.id}
                      title={guide.title}
                      isActive={isActive}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <GuideUploadForm />
      </CardContent>
    </Card>
  );
}

export default async function BotTextsPage() {
  const [overrides, guides] = await Promise.all([
    orpc.bot.getTexts().catch(() => ({}) as Record<string, string>),
    orpc.bot.listGuides().catch(() => []),
  ]);
  const groups = groupDefs();
  const activeS3Key = overrides[GUIDE_FILE_S3_KEY]?.trim() ?? "";

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Тексты бота</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Сообщения сценария для Telegram и MAX ботов, включая гайды
          (лид-магниты). Пустое поле возвращает текст по умолчанию.
          Поддерживается Markdown. Боты подхватывают изменения в течение минуты.
        </p>
      </div>

      <CrmWidgetsCard />

      <BotConnectorCard messenger="telegram" label="Telegram" />
      <BotConnectorCard messenger="max" label="MAX" />

      <TgPersonalConnectorCard />

      <GuidesLibraryCard guides={guides} activeS3Key={activeS3Key} />

      <BotTextsForm groups={groups} initialOverrides={overrides} />
    </div>
  );
}
