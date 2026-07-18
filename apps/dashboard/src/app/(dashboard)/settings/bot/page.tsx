import {
  GUIDE_FILE_NAME_KEY,
  GUIDE_FILE_SIZE_KEY,
  GUIDE_FILE_URL_KEY,
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
import { getBotTextsRecord } from "@psi-opora/db/queries";
import { deleteGuideAction, saveBotTextsAction } from "./actions";
import { CrmWidgetsCard } from "./crm-widgets-card";
import { GuideUploadForm } from "./guide-upload-form";

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "Начало диалога":
    "Приветствие с выбором: записаться на консультацию или получить гайд. Дальше — вопросы ветки гайда: категория (ребёнок / для себя) и тема трудностей.",
  "Запись на консультацию":
    "Ветка кнопки «Записаться»: согласие на ПДн → имя → телефон → email → заявка в Bitrix24.",
  "Лид-магнит (ветка «Ребёнок»)":
    "Запрос email и гайд, который бот отправляет родителям.",
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

function GuideFileCard({
  overrides,
}: {
  overrides: Record<string, string>;
}) {
  const fileName = overrides[GUIDE_FILE_NAME_KEY]?.trim();
  const fileUrl = overrides[GUIDE_FILE_URL_KEY]?.trim();
  const fileSize = Number(overrides[GUIDE_FILE_SIZE_KEY] ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Файл гайда (PDF)</CardTitle>
        <CardDescription>
          Боты отправляют этот PDF документом в чат после того, как клиент
          оставил email в ветке гайда. Хранится в S3 (используются настройки из
          раздела «Бэкап CRM»). До 10 МБ.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fileName ? (
          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <div className="flex flex-col">
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium underline underline-offset-2"
              >
                📎 {fileName}
              </a>
              <span className="text-xs text-muted-foreground">
                {formatSize(fileSize)}
              </span>
            </div>
            <form action={deleteGuideAction}>
              <Button type="submit" variant="outline" size="sm">
                Удалить
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Файл не загружен — бот отправит только текст гайда.
          </p>
        )}

        <GuideUploadForm hasFile={Boolean(fileName)} />
      </CardContent>
    </Card>
  );
}

export default async function BotTextsPage() {
  const overrides = await getBotTextsRecord().catch(
    () => ({}) as Record<string, string>,
  );
  const groups = groupDefs();

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Тексты бота</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Сообщения сценария для Telegram и MAX ботов, включая гайд
          (лид-магнит). Пустое поле возвращает текст по умолчанию.
          Поддерживается Markdown. Боты подхватывают изменения в течение минуты.
        </p>
      </div>

      <CrmWidgetsCard />

      <GuideFileCard overrides={overrides} />

      <form action={saveBotTextsAction} className="flex flex-col gap-6">
        {groups.map(({ group, defs }) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{group}</CardTitle>
              {GROUP_DESCRIPTIONS[group] && (
                <CardDescription>{GROUP_DESCRIPTIONS[group]}</CardDescription>
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

        <Button type="submit" className="self-start">
          Сохранить
        </Button>
      </form>
    </div>
  );
}
