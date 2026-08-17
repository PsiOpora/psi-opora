"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MessageSquareText, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc/client";

interface GuideCampaignView {
	id: string;
	keyword: string;
	title: string;
	guideId: string | null;
	emailSubject: string;
	emailBody: string;
	deliveryMessage: string;
	followUpDelayDays: number;
	followUpMessage: string;
	diagnosticCtaText: string;
	active: boolean;
}

interface FormState {
	keyword: string;
	title: string;
	guideId: string;
	emailSubject: string;
	emailBody: string;
	deliveryMessage: string;
	followUpDelayDays: string;
	followUpMessage: string;
	diagnosticCtaText: string;
	active: boolean;
}

const EMPTY_FORM: FormState = {
	keyword: "",
	title: "",
	guideId: "",
	emailSubject: "",
	emailBody: "",
	deliveryMessage: "",
	followUpDelayDays: "2",
	followUpMessage: "",
	diagnosticCtaText: "Согласен/согласна на диагностику",
	active: true,
};

function toForm(campaign: GuideCampaignView): FormState {
	return {
		keyword: campaign.keyword,
		title: campaign.title,
		guideId: campaign.guideId ?? "",
		emailSubject: campaign.emailSubject,
		emailBody: campaign.emailBody,
		deliveryMessage: campaign.deliveryMessage,
		followUpDelayDays: String(campaign.followUpDelayDays),
		followUpMessage: campaign.followUpMessage,
		diagnosticCtaText: campaign.diagnosticCtaText,
		active: campaign.active,
	};
}

function GuideCampaignForm({
	guides,
	value,
	onChange,
}: {
	guides: Array<{ id: string; title: string }>;
	value: FormState;
	onChange: (next: FormState) => void;
}) {
	const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
		onChange({ ...value, [key]: val });

	return (
		<div className="grid gap-4 py-2">
			<div className="grid grid-cols-2 gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="gc-keyword">Кодовое слово</Label>
					<Input
						id="gc-keyword"
						value={value.keyword}
						onChange={(e) => set("keyword", e.target.value)}
						placeholder="ШКОЛА"
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="gc-days">Follow-up через (дней)</Label>
					<Input
						id="gc-days"
						type="number"
						min={1}
						max={30}
						value={value.followUpDelayDays}
						onChange={(e) => set("followUpDelayDays", e.target.value)}
					/>
				</div>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="gc-title">Тема материала</Label>
				<Input
					id="gc-title"
					value={value.title}
					onChange={(e) => set("title", e.target.value)}
					placeholder="Почему одному ребёнку школа даётся легко, а другому — нет"
				/>
			</div>

			<div className="grid gap-1.5">
				<Label>PDF-гайд из библиотеки</Label>
				<Select
					value={value.guideId || "__none"}
					onValueChange={(v) => set("guideId", v === "__none" ? "" : v)}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Без файла — только текст со ссылкой" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__none">Без файла</SelectItem>
						{guides.map((guide) => (
							<SelectItem key={guide.id} value={guide.id}>
								{guide.title}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="gc-delivery">Сообщение при выдаче гайда</Label>
				<Textarea
					id="gc-delivery"
					rows={3}
					value={value.deliveryMessage}
					onChange={(e) => set("deliveryMessage", e.target.value)}
					placeholder="Спасибо! Данные получили. Сейчас отправим материал на почту..."
				/>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="gc-email-subject">Тема письма</Label>
					<Input
						id="gc-email-subject"
						value={value.emailSubject}
						onChange={(e) => set("emailSubject", e.target.value)}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="gc-cta">Текст кнопки на диагностику</Label>
					<Input
						id="gc-cta"
						value={value.diagnosticCtaText}
						onChange={(e) => set("diagnosticCtaText", e.target.value)}
					/>
				</div>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="gc-email-body">Текст письма</Label>
				<Textarea
					id="gc-email-body"
					rows={3}
					value={value.emailBody}
					onChange={(e) => set("emailBody", e.target.value)}
				/>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="gc-followup">Follow-up-сообщение (через N дней)</Label>
				<Textarea
					id="gc-followup"
					rows={3}
					value={value.followUpMessage}
					onChange={(e) => set("followUpMessage", e.target.value)}
					placeholder="Добрый день! Удалось ли вам выполнить задание?..."
				/>
			</div>

			<div className="flex items-center gap-2 text-sm">
				<Checkbox
					id="gc-active"
					checked={value.active}
					onCheckedChange={(checked) => set("active", checked === true)}
				/>
				<Label htmlFor="gc-active">
					Кампания активна (кодовое слово принимается ботом)
				</Label>
			</div>
		</div>
	);
}

function GuideCampaignDialog({
	guides,
	campaign,
	trigger,
}: {
	guides: Array<{ id: string; title: string }>;
	campaign?: GuideCampaignView;
	trigger: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [form, setForm] = useState<FormState>(
		campaign ? toForm(campaign) : EMPTY_FORM,
	);
	const queryClient = useQueryClient();

	useEffect(() => {
		if (open) setForm(campaign ? toForm(campaign) : EMPTY_FORM);
	}, [open, campaign]);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.guideCampaigns.list.key() });

	const createMutation = useMutation(
		orpc.guideCampaigns.create.mutationOptions({
			onSuccess: () => {
				toast.success("Кампания создана");
				setOpen(false);
				invalidate();
			},
			onError: (error) =>
				toast.error(error.message || "Не удалось создать кампанию"),
		}),
	);

	const updateMutation = useMutation(
		orpc.guideCampaigns.update.mutationOptions({
			onSuccess: () => {
				toast.success("Кампания обновлена");
				setOpen(false);
				invalidate();
			},
			onError: (error) =>
				toast.error(error.message || "Не удалось сохранить кампанию"),
		}),
	);

	const pending = createMutation.isPending || updateMutation.isPending;

	const submit = () => {
		const followUpDelayDays = Number.parseInt(form.followUpDelayDays, 10);
		if (!form.keyword.trim() || !form.title.trim()) {
			toast.error("Укажите кодовое слово и тему материала");
			return;
		}
		if (!Number.isFinite(followUpDelayDays) || followUpDelayDays < 1) {
			toast.error("Follow-up через сколько дней? Укажите число от 1");
			return;
		}
		if (!form.deliveryMessage.trim() || !form.followUpMessage.trim()) {
			toast.error("Заполните сообщение выдачи и follow-up-сообщение");
			return;
		}
		if (!form.emailSubject.trim() || !form.emailBody.trim()) {
			toast.error("Заполните тему и текст письма");
			return;
		}

		const payload = {
			keyword: form.keyword.trim(),
			title: form.title.trim(),
			guideId: form.guideId || null,
			emailSubject: form.emailSubject.trim(),
			emailBody: form.emailBody.trim(),
			deliveryMessage: form.deliveryMessage.trim(),
			followUpDelayDays,
			followUpMessage: form.followUpMessage.trim(),
			diagnosticCtaText: form.diagnosticCtaText.trim() || undefined,
			active: form.active,
		};

		if (campaign) updateMutation.mutate({ id: campaign.id, ...payload });
		else createMutation.mutate(payload);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{campaign
							? `Кампания «${campaign.title}»`
							: "Новая кампания по кодовому слову"}
					</DialogTitle>
					<DialogDescription>
						Клиент пишет боту кодовое слово — бот сразу ведёт его к согласию,
						email и выдаче этого материала, минуя обычный выбор темы.
					</DialogDescription>
				</DialogHeader>
				<GuideCampaignForm guides={guides} value={form} onChange={setForm} />
				<DialogFooter>
					<Button type="button" onClick={submit} disabled={pending}>
						{pending ? "Сохраняем…" : campaign ? "Сохранить" : "Создать"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function DeleteCampaignButton({ id, title }: { id: string; title: string }) {
	const queryClient = useQueryClient();
	const mutation = useMutation(
		orpc.guideCampaigns.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`Кампания «${title}» удалена`);
				queryClient.invalidateQueries({
					queryKey: orpc.guideCampaigns.list.key(),
				});
			},
			onError: (error) =>
				toast.error(error.message || "Не удалось удалить кампанию"),
		}),
	);

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={mutation.isPending}
				>
					Удалить
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Удалить кампанию?</AlertDialogTitle>
					<AlertDialogDescription>
						Кодовое слово «{title}» перестанет распознаваться ботом. Уже
						отправленные выдачи и заявки в Bitrix останутся без изменений.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Отмена</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => mutation.mutate({ id })}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						Удалить
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function GuideCampaignsCard() {
	const [open, setOpen] = useState(false);
	const { data: campaigns = [] } = useQuery(
		orpc.guideCampaigns.list.queryOptions(),
	);
	const { data: guides = [] } = useQuery(orpc.bot.listGuides.queryOptions());

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center gap-4">
						<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
							<MessageSquareText />
						</div>
						<div className="min-w-0 flex-1">
							<CardTitle>Кампании по кодовому слову</CardTitle>
							<CardDescription className="mt-1">
								{campaigns.length > 0
									? `Активных: ${campaigns.filter((c) => c.active).length} из ${campaigns.length}`
									: "Пока не настроено ни одной кампании"}
							</CardDescription>
						</div>
						<CollapsibleTrigger asChild>
							<Button type="button" variant="ghost" size="sm">
								{open ? "Скрыть" : "Управлять"}
								<ChevronDown
									data-icon="inline-end"
									className={open ? "rotate-180" : undefined}
								/>
							</Button>
						</CollapsibleTrigger>
					</div>
				</CardHeader>
				<CollapsibleContent>
					<CardContent className="flex flex-col gap-4 border-t pt-6">
						<p className="text-sm text-muted-foreground">
							Клиент пишет боту кодовое слово (например «ШКОЛА») — бот сразу
							ведёт к согласию, email и выдаче этого материала, минуя обычный
							выбор темы. Через заданное число дней бот сам напоминает и
							предлагает бесплатную диагностику.
						</p>

						{campaigns.length > 0 && (
							<div className="flex flex-col gap-2">
								{campaigns.map((campaign) => (
									<div
										key={campaign.id}
										className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-3"
									>
										<div className="flex min-w-0 flex-col gap-0.5">
											<div className="flex items-center gap-2">
												<span className="truncate text-sm font-medium">
													{campaign.title}
												</span>
												<Badge
													variant={campaign.active ? "default" : "outline"}
													className="text-[10px]"
												>
													{campaign.active ? "активна" : "выключена"}
												</Badge>
											</div>
											<span className="text-xs text-muted-foreground">
												Слово «{campaign.keyword}» · follow-up через{" "}
												{campaign.followUpDelayDays} дн.
											</span>
										</div>
										<div className="flex items-center gap-2">
											<GuideCampaignDialog
												guides={guides}
												campaign={campaign}
												trigger={
													<Button type="button" variant="outline" size="sm">
														Изменить
													</Button>
												}
											/>
											<DeleteCampaignButton
												id={campaign.id}
												title={campaign.title}
											/>
										</div>
									</div>
								))}
							</div>
						)}

						<GuideCampaignDialog
							guides={guides}
							trigger={
								<Button
									type="button"
									variant="secondary"
									className="self-start"
								>
									<Plus data-icon="inline-start" />
									Добавить кампанию
								</Button>
							}
						/>
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>
	);
}
