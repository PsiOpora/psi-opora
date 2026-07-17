import {
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
import { saveBotTextsAction } from "./actions";

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "Начало диалога":
    "Приветствие и вопросы с кнопками: категория (ребёнок / для себя) и тема трудностей.",
  "Лид-магнит (ветка «Ребёнок»)":
    "Запрос email и гайд, который бот отправляет родителям.",
  "Заявка на консультацию":
    "Запрос телефона. Оставленный номер уходит менеджеру в Bitrix24.",
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
          Поддерживается Markdown. Боты подхватывают изменения в течение
          минуты.
        </p>
      </div>

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
