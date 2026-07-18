import {
  GUIDE_FILE_S3_KEY,
  SCENARIO_TEXT_DEFS,
  type ScenarioTextDef,
} from "@psi-opora/bot-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getBotTextsRecord, listBotGuides } from "@psi-opora/db/queries";
import {
  deleteGuideAction,
  saveBotTextsAction,
  setActiveGuideAction,
} from "./actions";
import { CrmWidgetsCard } from "./crm-widgets-card";
import { GroupTabs } from "./group-tabs";
import { GuideUploadForm } from "./guide-upload-form";

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "Начало диалога":
    "Приветствие с выбором: записаться на консультацию или получить гайд. Дальше — вопросы ветки гайда: категория (ребёнок / для себя) и тема трудностей.",
  "Запись на консультацию":
    "Ветка кнопки «Записаться»: согласие на ПДн → имя → телефон → email → заявка в Bitrix24.",
  "Лид-магнит (ветка «Ребёнок»)":
    "Запрос email и гайд, который бот отправляет родителям — вложением на email (нужен Resend); в MAX дополнительно файлом в чат, в Telegram — только на почту.",
  "Заявка на консультацию":
    "Запрос телефона в ветке гайда. Оставленный номер уходит менеджеру в Bitrix24.",
  Рассылка:
    "Вопрос о подписке на материалы — задаётся в ветке «Помощь для себя».",
  Напоминание:
    "Отправляется, если пользователь замолчал посреди сценария. Второго напоминания нет — сценарий тихо завершается.",
};

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
                      <form action={setActiveGuideAction}>
                        <input type="hidden" name="id" value={guide.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Сделать активным
                        </Button>
                      </form>
                    )}
                    <form action={deleteGuideAction}>
                      <input type="hidden" name="id" value={guide.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Удалить
                      </Button>
                    </form>
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
    getBotTextsRecord().catch(() => ({}) as Record<string, string>),
    listBotGuides().catch(() => []),
  ]);
  const groups = groupDefs();
  const activeS3Key = overrides[GUIDE_FILE_S3_KEY]?.trim() ?? "";

  const changedCounts = Object.fromEntries(
    groups.map(({ group, defs }) => [
      group,
      defs.filter((def) => overrides[def.key]?.trim()).length,
    ]),
  );

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

      <GuidesLibraryCard guides={guides} activeS3Key={activeS3Key} />

      <form action={saveBotTextsAction} className="flex flex-col gap-6">
        <GroupTabs
          groups={groups.map(({ group }) => group)}
          changedCounts={changedCounts}
        >
          {groups.map(({ group, defs }) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle>{group}</CardTitle>
                {GROUP_DESCRIPTIONS[group] && (
                  <CardDescription>
                    {GROUP_DESCRIPTIONS[group]}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {defs.map((def) => {
                  const override = overrides[def.key];
                  return (
                    <div key={def.key} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={def.key}
                          className="text-xs text-muted-foreground"
                        >
                          {def.label}
                        </Label>
                        {override?.trim() && (
                          <Badge variant="secondary" className="text-[10px]">
                            изменено
                          </Badge>
                        )}
                      </div>
                      {def.multiline ? (
                        <Textarea
                          id={def.key}
                          name={def.key}
                          defaultValue={override ?? def.defaultValue}
                          placeholder={def.defaultValue}
                          className="text-sm"
                        />
                      ) : (
                        <Input
                          id={def.key}
                          name={def.key}
                          defaultValue={override ?? def.defaultValue}
                          placeholder={def.defaultValue}
                          className="text-sm"
                        />
                      )}
                      {def.hint && (
                        <p className="text-xs text-muted-foreground">
                          {def.hint}
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </GroupTabs>

        <Button type="submit" className="self-start">
          Сохранить
        </Button>
      </form>
    </div>
  );
}
