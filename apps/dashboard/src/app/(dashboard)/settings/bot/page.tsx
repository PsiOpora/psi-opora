"use client";

import type { ScenarioTextDef } from "@psi-opora/bot-core";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { orpc } from "@/lib/orpc/client";
import { BotTextsForm } from "./bot-texts-form";
import { DeleteGuideButton, SetActiveGuideButton } from "./guide-actions";
import { GuideUploadForm } from "./guide-upload-form";

function groupDefs(
  defs: ScenarioTextDef[],
): Array<{ group: string; defs: ScenarioTextDef[] }> {
  const groups: Array<{ group: string; defs: ScenarioTextDef[] }> = [];
  for (const def of defs) {
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
          (нужен UNISENDER_API_KEY) и, в MAX, дополнительно документом в чат
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

export default function BotTextsPage() {
  const { data: overrides = {} } = useQuery(orpc.bot.getTexts.queryOptions());
  const { data: guides = [] } = useQuery(orpc.bot.listGuides.queryOptions());
  const { data: defsData } = useQuery({
    queryKey: ["dashboard-bot-texts-defs"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/bot-texts-defs");
      if (!res.ok) throw new Error("Не удалось загрузить тексты бота");
      return (await res.json()) as {
        defs: ScenarioTextDef[];
        guideFileS3Key: string;
      };
    },
  });
  const groups = groupDefs(defsData?.defs ?? []);
  const activeS3Key = defsData
    ? (overrides[defsData.guideFileS3Key]?.trim() ?? "")
    : "";

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

      <GuidesLibraryCard guides={guides} activeS3Key={activeS3Key} />

      <BotTextsForm groups={groups} initialOverrides={overrides} />
    </div>
  );
}
