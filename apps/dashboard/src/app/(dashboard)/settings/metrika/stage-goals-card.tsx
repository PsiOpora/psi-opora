"use client";

import {
	type YandexMetrikaStageGoalInput,
	yandexMetrikaStageGoalSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NotConnected } from "@/components/dashboard/not-connected";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import { orpc } from "@/lib/orpc/client";

interface StageOption {
	stageId: string;
	stageName: string;
	sort: number;
	categoryId: string;
	categoryName: string;
}

/** CATEGORY_ID из STAGE_ID: "C5:NEW" → "5", "NEW" (основная воронка) → "0". */
function categoryOfStage(stageId: string): string {
	return stageId.match(/^C(\d+):/)?.[1] ?? "0";
}

const EMPTY_FORM: YandexMetrikaStageGoalInput = {
	name: "",
	goalId: "",
	stageId: "",
	enabled: true,
};

/** Показывает цели по стадиям Bitrix, статистику конверсий и форму управления целями. */
export function YandexMetrikaStageGoalsCard() {
	const queryClient = useQueryClient();
	const bitrix = useBitrixData(["stageNames", "categoryNames"]);
	const { data: goals, isLoading } = useQuery(
		orpc.yandexMetrika.listStageGoals.queryOptions(),
	);

	const [editingId, setEditingId] = useState<string | null>(null);
	const [form, setForm] = useState<YandexMetrikaStageGoalInput>(EMPTY_FORM);

	const stages = bitrix.data?.stageNames ?? new Map();
	const categories = bitrix.data?.categoryNames ?? new Map();
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
				a.categoryId.localeCompare(b.categoryId, undefined, { numeric: true }) ||
				a.sort - b.sort,
		);
	const byCategory = new Map<string, StageOption[]>();
	for (const option of options) {
		const list = byCategory.get(option.categoryName) ?? [];
		list.push(option);
		byCategory.set(option.categoryName, list);
	}
	/** Возвращает название воронки и стадии, а для неизвестной стадии — её ID. */
	const stageLabel = (stageId: string) => {
		const option = options.find((o) => o.stageId === stageId);
		return option ? `${option.categoryName} → ${option.stageName}` : stageId;
	};

	/** Помечает список целей устаревшим и запускает обновление активного запроса. */
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.yandexMetrika.listStageGoals.key(),
		});
	/** Показывает сообщение ошибки изменения цели или запасной текст. */
	const onError = (error: Error) =>
		toast.error(error.message || "Не удалось сохранить цель");
	/** Завершает редактирование и возвращает форму к значениям для новой цели. */
	const resetForm = () => {
		setEditingId(null);
		setForm(EMPTY_FORM);
	};

	const createMutation = useMutation(
		orpc.yandexMetrika.createStageGoal.mutationOptions({
			onSuccess: () => {
				toast.success("Цель добавлена");
				resetForm();
				invalidate();
			},
			onError,
		}),
	);
	const updateMutation = useMutation(
		orpc.yandexMetrika.updateStageGoal.mutationOptions({
			onSuccess: () => {
				toast.success("Цель сохранена");
				resetForm();
				invalidate();
			},
			onError,
		}),
	);
	const removeMutation = useMutation(
		orpc.yandexMetrika.removeStageGoal.mutationOptions({
			onSuccess: () => {
				toast.success("Цель удалена");
				invalidate();
			},
			onError,
		}),
	);

	const pending = createMutation.isPending || updateMutation.isPending;

	/** Проверяет форму и запускает создание либо обновление выбранной цели. */
	function submit() {
		const parsed = yandexMetrikaStageGoalSchema.safeParse(form);
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? "Проверьте поля формы");
			return;
		}
		if (editingId) {
			updateMutation.mutate({ id: editingId, ...parsed.data });
		} else {
			createMutation.mutate(parsed.data);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Цели по стадиям воронки</CardTitle>
				<CardDescription>
					Как только сделка попадает в выбранную стадию воронки, в Метрику
					уходит конверсия этой цели — один раз на сделку. Сработает только
					для сделок, созданных ботом по рекламному переходу: у них есть
					ClientID визита. Цель должна быть создана в счётчике заранее (тип
					«JavaScript-событие»), а счётчик и токен берутся из настроек выше.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				{isLoading ? (
					<p className="text-sm text-muted-foreground">Загрузка…</p>
				) : goals && goals.length > 0 ? (
					<ul className="flex flex-col divide-y rounded-md border">
						{goals.map((goal) => (
							<li
								key={goal.id}
								className="flex items-center gap-3 px-3 py-2 text-sm"
							>
								<Checkbox
									checked={goal.enabled}
									aria-label={`Цель «${goal.name}» включена`}
									onCheckedChange={(checked) =>
										updateMutation.mutate({
											id: goal.id,
											name: goal.name,
											goalId: goal.goalId,
											stageId: goal.stageId,
											enabled: checked === true,
										})
									}
								/>
								<div className="min-w-0 flex-1">
									<div className="truncate font-medium">{goal.name}</div>
									<div className="truncate text-xs text-muted-foreground">
										<span className="font-mono">{goal.goalId}</span> ·{" "}
										{stageLabel(goal.stageId)}
									</div>
								</div>
								<span
									className="shrink-0 text-xs text-muted-foreground"
									title="Отправлено конверсий"
								>
									{goal.sentCount}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="Изменить цель"
									onClick={() => {
										setEditingId(goal.id);
										setForm({
											name: goal.name,
											goalId: goal.goalId,
											stageId: goal.stageId,
											enabled: goal.enabled,
										});
									}}
								>
									<Pencil className="size-4" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="Удалить цель"
									disabled={removeMutation.isPending}
									onClick={() => {
										if (window.confirm(`Удалить цель «${goal.name}»?`)) {
											if (editingId === goal.id) resetForm();
											removeMutation.mutate({ id: goal.id });
										}
									}}
								>
									<Trash2 className="size-4" />
								</Button>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						Пока нет ни одной цели. Добавьте первую ниже.
					</p>
				)}

				{bitrix.isLoading ? (
					<p className="text-sm text-muted-foreground">Загрузка воронок…</p>
				) : bitrix.isError ? (
					<p className="text-sm text-destructive">
						Не удалось загрузить воронки. Попробуйте обновить страницу.
					</p>
				) : !bitrix.data?.connected ? (
					<NotConnected />
				) : (
					<div className="flex flex-col gap-4">
						<h3 className="text-sm font-medium">
							{editingId ? "Изменить цель" : "Новая цель"}
						</h3>
						<div className="grid grid-cols-2 gap-4">
							<div className="flex flex-col gap-2">
								<Label className="text-xs text-muted-foreground">
									Название
								</Label>
								<Input
									placeholder="Оплата консультации"
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label className="text-xs text-muted-foreground">
									Идентификатор цели в Метрике
								</Label>
								<Input
									placeholder="consultation_paid"
									className="font-mono text-sm"
									value={form.goalId}
									onChange={(e) => setForm({ ...form, goalId: e.target.value })}
								/>
							</div>
						</div>
						<div className="flex flex-col gap-2">
							<Label className="text-xs text-muted-foreground">
								Воронка и стадия
							</Label>
							<Select
								value={form.stageId}
								onValueChange={(stageId) => setForm({ ...form, stageId })}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Выберите стадию" />
								</SelectTrigger>
								<SelectContent>
									{[...byCategory.entries()].map(([categoryName, list]) => (
										<SelectGroup key={categoryName}>
											<SelectLabel>{categoryName}</SelectLabel>
											{list.map((stage) => (
												<SelectItem key={stage.stageId} value={stage.stageId}>
													{stage.stageName}
												</SelectItem>
											))}
										</SelectGroup>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex gap-2">
							<Button type="button" disabled={pending} onClick={submit}>
								{pending
									? "Сохраняем…"
									: editingId
										? "Сохранить"
										: "Добавить цель"}
							</Button>
							{editingId && (
								<Button type="button" variant="outline" onClick={resetForm}>
									Отмена
								</Button>
							)}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
