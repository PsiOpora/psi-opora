"use client";

import type { ScenarioTextDef, ScenarioTextSection } from "@psi-opora/bot-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw, Save } from "lucide-react";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc/client";
import { GroupTabs, type GroupTabsSection } from "./group-tabs";

/**
 * Шаги, которых нет ни в одном блоке SCENARIO_TEXT_SECTIONS, всё равно
 * показываем — иначе новое поле в SCENARIO_TEXT_DEFS молча пропадёт из
 * дашборда, если про него забыли в структуре.
 */
const FALLBACK_SECTION_LABEL = "Прочее";

export function BotTextsForm({
  sections,
  groups,
  initialOverrides,
}: {
  sections: ScenarioTextSection[];
  groups: Array<{ group: string; defs: ScenarioTextDef[] }>;
  initialOverrides: Record<string, string>;
}) {
  const queryClient = useQueryClient();
  const fieldRefs = useRef(
    new Map<string, HTMLInputElement | HTMLTextAreaElement>(),
  );

  const defsByGroup = new Map(groups.map(({ group, defs }) => [group, defs]));
  const descriptionByGroup = new Map(
    sections.flatMap((section) =>
      section.groups.map((info) => [info.group, info.description] as const),
    ),
  );

  const placedGroups = new Set(
    sections.flatMap((section) => section.groups.map((info) => info.group)),
  );
  const orphanGroups = groups
    .map(({ group }) => group)
    .filter((group) => !placedGroups.has(group));

  const tabsSections: GroupTabsSection[] = [
    ...sections.map((section) => ({
      label: section.label,
      numbered: section.numbered,
      groups: section.groups
        .map((info) => info.group)
        .filter((group) => defsByGroup.has(group)),
    })),
    ...(orphanGroups.length > 0
      ? [
          {
            label: FALLBACK_SECTION_LABEL,
            numbered: false,
            groups: orphanGroups,
          },
        ]
      : []),
  ].filter((section) => section.groups.length > 0);

  const defaultValues = Object.fromEntries(
    groups.flatMap(({ defs }) =>
      defs.map((def) => [
        def.key,
        initialOverrides[def.key] ?? def.defaultValue,
      ]),
    ),
  );

  const form = useForm<Record<string, string>>({ defaultValues });
  const isDirty = form.formState.isDirty;

  const insertPlaceholder = (fieldKey: string, placeholder: string) => {
    const element = fieldRefs.current.get(fieldKey);
    const currentValue = form.getValues(fieldKey) ?? "";
    const selectionStart = element?.selectionStart ?? currentValue.length;
    const selectionEnd = element?.selectionEnd ?? currentValue.length;
    const nextValue =
      currentValue.slice(0, selectionStart) +
      placeholder +
      currentValue.slice(selectionEnd);

    form.setValue(fieldKey, nextValue, {
      shouldDirty: true,
      shouldTouch: true,
    });

    requestAnimationFrame(() => {
      if (!element) return;
      const caretPosition = selectionStart + placeholder.length;
      element.focus();
      element.setSelectionRange(caretPosition, caretPosition);
    });
  };

  const changedCounts = Object.fromEntries(
    groups.map(({ group, defs }) => [
      group,
      defs.filter((def) => initialOverrides[def.key]?.trim()).length,
    ]),
  );

  const mutation = useMutation(
    orpc.bot.saveTexts.mutationOptions({
      onSuccess: () => {
        toast.success("Тексты бота сохранены");
        form.reset(form.getValues());
        queryClient.invalidateQueries({ queryKey: orpc.bot.getTexts.key() });
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось сохранить тексты");
      },
    }),
  );

  const groupCards = Object.fromEntries(
    groups.map(({ group, defs }) => [
      group,
      <Card key={group} className="overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>{group}</CardTitle>
              {descriptionByGroup.get(group) && (
                <CardDescription>
                  {descriptionByGroup.get(group)}
                </CardDescription>
              )}
            </div>
            <Badge variant="outline">
              {defs.length} {defs.length === 1 ? "поле" : "полей"}
            </Badge>
          </div>
          {defs.some((def) => def.multiline) && (
            <p className="text-xs text-muted-foreground">
              Разметка: <code>*жирный*</code>, <code>_курсив_</code>,{" "}
              <code>[текст ссылки](https://…)</code> — клиент увидит уже
              оформленное сообщение, без звёздочек и скобок.
            </p>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-6">
          {defs.map((def) => (
            <FormField
              key={def.key}
              control={form.control}
              name={def.key}
              render={({ field }) => (
                <FormItem>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={def.key} className="font-medium">
                        {def.label}
                      </Label>
                      {initialOverrides[def.key]?.trim() && (
                        <Badge variant="secondary" className="text-[10px]">
                          изменено
                        </Badge>
                      )}
                    </div>
                    {def.placeholders?.length ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="mr-1 text-xs text-muted-foreground">
                          Вставить:
                        </span>
                        {def.placeholders.map((placeholder) => (
                          <Button
                            key={placeholder}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 font-mono text-xs"
                            aria-label={`Вставить ${placeholder} в поле «${def.label}»`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() =>
                              insertPlaceholder(def.key, placeholder)
                            }
                          >
                            {placeholder}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <FormControl>
                    {def.multiline ? (
                      <Textarea
                        id={def.key}
                        placeholder={def.defaultValue}
                        className="min-h-28 resize-y text-sm leading-relaxed"
                        {...field}
                        ref={(element) => {
                          field.ref(element);
                          if (element) {
                            fieldRefs.current.set(def.key, element);
                          } else {
                            fieldRefs.current.delete(def.key);
                          }
                        }}
                      />
                    ) : (
                      <Input
                        id={def.key}
                        placeholder={def.defaultValue}
                        className="text-sm"
                        {...field}
                        ref={(element) => {
                          field.ref(element);
                          if (element) {
                            fieldRefs.current.set(def.key, element);
                          } else {
                            fieldRefs.current.delete(def.key);
                          }
                        }}
                      />
                    )}
                  </FormControl>
                  {def.hint && (
                    <p className="text-xs text-muted-foreground">{def.hint}</p>
                  )}
                </FormItem>
              )}
            />
          ))}
        </CardContent>
      </Card>,
    ]),
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="flex flex-col gap-5"
      >
        <GroupTabs sections={tabsSections} changedCounts={changedCounts}>
          {groupCards}
        </GroupTabs>

        <div className="sticky bottom-4 z-10 ml-auto flex items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur">
          <span className="hidden px-2 text-sm text-muted-foreground sm:inline">
            {isDirty
              ? "Есть несохранённые изменения"
              : "Все изменения сохранены"}
          </span>
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => form.reset()}
            >
              <RotateCcw data-icon="inline-start" />
              Отменить
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={mutation.isPending || !isDirty}
          >
            {mutation.isPending ? (
              "Сохраняем…"
            ) : isDirty ? (
              <>
                <Save data-icon="inline-start" />
                Сохранить
              </>
            ) : (
              <>
                <Check data-icon="inline-start" />
                Сохранено
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
