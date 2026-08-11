"use client";

import type { ScenarioTextDef } from "@psi-opora/bot-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw, Save } from "lucide-react";
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
import { GroupTabs } from "./group-tabs";

const GROUP_DESCRIPTIONS: Record<string, string> = {
	"1. Старт":
		"Приветствие с выбором: записаться на консультацию или получить гайд.",
	"2. Согласие на данные":
		"Общий шаг для обоих флоу — показывается сразу после выбора кнопки на старте, до продолжения диалога.",
	"3. Флоу «Записаться»":
		"Ветка кнопки «Записаться»: имя → телефон → email → заявка в Bitrix24. Отдельный флоу, не связан с гайдом.",
	"4. Флоу «Гайд»: категория и тема":
		"Ветка кнопки «Получить гайд»: сначала категория (ребёнок / для себя), затем тема трудностей — общие для обеих подветок ниже.",
	"5. Флоу «Гайд» (ребёнок): email и гайд":
		"Только подветка «Ребёнок»: запрос email и сам гайд — вложением на email (нужен Unisender); в MAX дополнительно файлом в чат, в Telegram — только на почту.",
	"6. Флоу «Гайд»: телефон":
		"Общий шаг для обеих подветок флоу «Гайд». Оставленный номер уходит менеджеру в Bitrix24.",
	"7. Флоу «Гайд» (для себя): рассылка":
		"Только подветка «Для себя»: вопрос о подписке на материалы — после шага «телефон».",
	"8. Напоминание":
		"Отправляется, если пользователь замолчал посреди сценария — в любом флоу. Второго напоминания нет — сценарий тихо завершается.",
	"9. Напоминание о консультации":
		"Уходит клиенту в чат Открытой линии Bitrix24 за час до начала оплаченной консультации (сделка в CRM). Не связано со сценарием бота выше.",
	"10. Напоминание о диагностике":
		"Уходит клиенту в чат Открытой линии Bitrix24 за час до начала диагностической консультации (сделка в CRM, отдельное поле с датой/временем).",
};

export function BotTextsForm({
	groups,
	initialOverrides,
}: {
	groups: Array<{ group: string; defs: ScenarioTextDef[] }>;
	initialOverrides: Record<string, string>;
}) {
	const queryClient = useQueryClient();

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

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
				className="flex flex-col gap-5"
			>
				<GroupTabs
					groups={groups.map(({ group }) => group)}
					changedCounts={changedCounts}
				>
					{groups.map(({ group, defs }) => (
						<Card key={group} className="overflow-hidden">
							<CardHeader className="border-b bg-muted/30">
								<div className="flex flex-wrap items-start justify-between gap-4">
									<div className="flex flex-col gap-1.5">
										<CardTitle>{group.replace(/^\d+\.\s*/, "")}</CardTitle>
										{GROUP_DESCRIPTIONS[group] && (
											<CardDescription>
												{GROUP_DESCRIPTIONS[group]}
											</CardDescription>
										)}
									</div>
									<Badge variant="outline">
										{defs.length} {defs.length === 1 ? "поле" : "полей"}
									</Badge>
								</div>
							</CardHeader>
							<CardContent className="flex flex-col gap-6 pt-6">
								{defs.map((def) => (
									<FormField
										key={def.key}
										control={form.control}
										name={def.key}
										render={({ field }) => (
											<FormItem>
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
												<FormControl>
													{def.multiline ? (
														<Textarea
															id={def.key}
															placeholder={def.defaultValue}
															className="min-h-28 resize-y text-sm leading-relaxed"
															{...field}
														/>
													) : (
														<Input
															id={def.key}
															placeholder={def.defaultValue}
															className="text-sm"
															{...field}
														/>
													)}
												</FormControl>
												{def.hint && (
													<p className="text-xs text-muted-foreground">
														{def.hint}
													</p>
												)}
											</FormItem>
										)}
									/>
								))}
							</CardContent>
						</Card>
					))}
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
