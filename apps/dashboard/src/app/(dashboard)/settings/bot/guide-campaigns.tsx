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
import {
	BotUsernamesEditor,
	CampaignSourceLinks,
	CampaignStartLinks,
	isStartParamSafe,
} from "./bot-links";

interface GuideCampaignView {
	id: string;
	keyword: string;
	title: string;
	guideId: string | null;
	welcomeMessage: string | null;
	emailQuestion: string;
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
	welcomeMessage: string;
	emailQuestion: string;
	emailSubject: string;
	emailBody: string;
	deliveryMessage: string;
	followUpDelayDays: string;
	followUpMessage: string;
	diagnosticCtaText: string;
	active: boolean;
}

/** Поля, которые автоматически подстраиваются под тему материала (title). */
const AUTO_TEXT_FIELDS = [
	"emailQuestion",
	"emailSubject",
	"emailBody",
	"deliveryMessage",
	"followUpMessage",
] as const satisfies readonly (keyof FormState)[];

type AutoTextField = (typeof AUTO_TEXT_FIELDS)[number];

/**
 * Шаблоны текстов кампании. Пока пользователь не отредактировал поле
 * вручную, оно пересчитывается при вводе темы материала.
 */
function buildAutoTexts(title: string): Record<AutoTextField, string> {
	const trimmed = title.trim();
	const quoted = trimmed ? `«${trimmed}»` : "";
	const materialWithTitle = trimmed ? `материал ${quoted}` : "материал";
	const materialWithTitleAcc = trimmed
		? `материалом ${quoted}`
		: "полученным материалом";

	return {
		emailQuestion: trimmed
			? `На какой email отправить материал? Пришлю ${materialWithTitle}.`
			: "На какой email отправить материал?",
		emailSubject: trimmed
			? `${quoted} — материалы от центра «Опора»`
			: "Материалы от центра «Опора»",
		emailBody:
			"Здравствуйте!\n\n" +
			`Как и обещали — прикладываем к письму ${materialWithTitle}.\n\n` +
			"Центр психологической помощи «Пси-Опора»",
		deliveryMessage:
			`Спасибо! Отправил ${materialWithTitle} на ваш email. ` +
			"А чтобы не ждать письма — держите файл прямо здесь 👇",
		followUpMessage:
			`Добрый день! Удалось ли вам ознакомиться с ${materialWithTitleAcc}? ` +
			"Если появились вопросы, приглашаем на бесплатную 30-минутную " +
			"диагностическую консультацию с психологом центра «Опора». " +
			"Нажмите кнопку ниже, если согласны, — и мы свяжемся с вами.",
	};
}

const EMPTY_FORM: FormState = {
	keyword: "",
	title: "",
	guideId: "",
	welcomeMessage: "",
	followUpDelayDays: "2",
	diagnosticCtaText: "Согласен/согласна на диагностику",
	active: true,
	...buildAutoTexts(""),
};

function toForm(campaign: GuideCampaignView): FormState {
	return {
		keyword: campaign.keyword,
		title: campaign.title,
		guideId: campaign.guideId ?? "",
		welcomeMessage: campaign.welcomeMessage ?? "",
		emailQuestion: campaign.emailQuestion,
		emailSubject: campaign.emailSubject,
		emailBody: campaign.emailBody,
		deliveryMessage: campaign.deliveryMessage,
		followUpDelayDays: String(campaign.followUpDelayDays),
		followUpMessage: campaign.followUpMessage,
		diagnosticCtaText: campaign.diagnosticCtaText,
		active: campaign.active,
	};
}

/**
 * Копия существующей кампании для новой: ключевое слово стираем (уникально
 * в БД), guideId — тоже (пусть пользователь выберет свой файл), остальные
 * тексты берём как есть.
 */
function cloneForm(campaign: GuideCampaignView): FormState {
	const base = toForm(campaign);
	return { ...base, keyword: "", guideId: "" };
}

function GuideCampaignForm({
	guides,
	otherCampaigns,
	value,
	onChange,
	manualFields,
	onManualFieldsChange,
	allowClone,
}: {
	guides: Array<{ id: string; title: string }>;
	otherCampaigns: GuideCampaignView[];
	value: FormState;
	onChange: (next: FormState) => void;
	manualFields: ReadonlySet<AutoTextField>;
	onManualFieldsChange: (next: ReadonlySet<AutoTextField>) => void;
	allowClone: boolean;
}) {
	const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
		onChange({ ...value, [key]: val });

	/** Пользователь правит одно из авто-полей — фиксируем его и больше не трогаем. */
	const setAutoText = (key: AutoTextField, val: string) => {
		if (!manualFields.has(key)) {
			const next = new Set(manualFields);
			next.add(key);
			onManualFieldsChange(next);
		}
		set(key, val);
	};

	/** При изменении темы пересчитываем тексты, которых пользователь ещё не касался. */
	const setTitle = (nextTitle: string) => {
		const auto = buildAutoTexts(nextTitle);
		const next: FormState = { ...value, title: nextTitle };
		for (const key of AUTO_TEXT_FIELDS) {
			if (!manualFields.has(key)) next[key] = auto[key];
		}
		onChange(next);
	};

	/** Выбор гайда: если тема пуста — подставляем название файла в тему. */
	const setGuide = (nextGuideId: string) => {
		const guide = nextGuideId
			? guides.find((g) => g.id === nextGuideId)
			: undefined;
		if (!value.title.trim() && guide) {
			const auto = buildAutoTexts(guide.title);
			const next: FormState = {
				...value,
				guideId: nextGuideId,
				title: guide.title,
			};
			for (const key of AUTO_TEXT_FIELDS) {
				if (!manualFields.has(key)) next[key] = auto[key];
			}
			onChange(next);
			return;
		}
		set("guideId", nextGuideId);
	};

	/** Клонирование существующей кампании: копируем поля и фиксируем их как ручные. */
	const cloneFrom = (campaignId: string) => {
		const source = otherCampaigns.find((c) => c.id === campaignId);
		if (!source) return;
		onChange(cloneForm(source));
		onManualFieldsChange(new Set(AUTO_TEXT_FIELDS));
		toast.success(`Поля скопированы из «${source.title}»`);
	};

	return (
		<div className="grid gap-4 py-2">
			{allowClone && otherCampaigns.length > 0 && (
				<div className="grid gap-1.5 rounded-md border border-dashed bg-muted/30 p-3">
					<Label
						htmlFor="gc-clone"
						className="text-xs font-normal text-muted-foreground"
					>
						Быстрый старт — заполнить поля на основе уже настроенной кампании
					</Label>
					<Select value="" onValueChange={cloneFrom}>
						<SelectTrigger id="gc-clone" className="w-full">
							<SelectValue placeholder="Скопировать поля из кампании…" />
						</SelectTrigger>
						<SelectContent>
							{otherCampaigns.map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.title}
									{c.keyword ? ` · «${c.keyword}»` : ""}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			<FormStep
				title="Шаг 1. Как клиент попадает в кампанию"
				description="Кодовое слово можно написать боту в чат или зашить в ссылку — результат одинаковый."
			>
				<div className="grid gap-1.5">
					<Label htmlFor="gc-keyword">Кодовое слово</Label>
					<Input
						id="gc-keyword"
						value={value.keyword}
						onChange={(e) => set("keyword", e.target.value)}
						placeholder="SCHOOL"
					/>
					{value.keyword.trim() && !isStartParamSafe(value.keyword) ? (
						<p className="text-xs text-muted-foreground">
							Слово с кириллицей или пробелами бот примет только текстом в чате
							— ссылку с ним собрать нельзя. Для ссылки используйте латиницу,
							цифры, «_» и «-».
						</p>
					) : (
						<CampaignStartLinks keyword={value.keyword} />
					)}
				</div>

				{value.keyword.trim() && isStartParamSafe(value.keyword) && (
					<CampaignSourceLinks keyword={value.keyword} />
				)}

				<div className="grid gap-1.5">
					<Label htmlFor="gc-welcome">Приветствие (необязательно)</Label>
					<Textarea
						id="gc-welcome"
						rows={2}
						value={value.welcomeMessage}
						onChange={(e) => set("welcomeMessage", e.target.value)}
						placeholder="Например: Здравствуйте! Вы перешли по рекламе ВКонтакте — сейчас пришлём материал."
					/>
					<p className="text-xs text-muted-foreground">
						Показывается первым сообщением сразу по кодовому слову или ссылке —
						до согласия на обработку данных. Пусто — этот шаг пропускается.
					</p>
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
			</FormStep>

			<FormStep
				title="Шаг 2. Что выдаём"
				description="Тема подставляется в тексты письма и сообщений ниже, пока вы их не отредактировали вручную."
			>
				<div className="grid gap-1.5">
					<Label htmlFor="gc-title">Тема материала</Label>
					<Input
						id="gc-title"
						value={value.title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Почему одному ребёнку школа даётся легко, а другому — нет"
					/>
					<p className="text-xs text-muted-foreground">
						Эта же тема уходит в Bitrix24 — в комментарий и метку кампании
						сделки, по ней потом видно источник заявки в CRM-отчётах.
					</p>
				</div>

				<div className="grid gap-1.5">
					<Label>PDF-гайд из библиотеки</Label>
					<Select
						value={value.guideId || "__none"}
						onValueChange={(v) => setGuide(v === "__none" ? "" : v)}
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
					<p className="text-xs text-muted-foreground">
						Файлы загружаются в блоке «PDF-гайды» выше. Без файла клиент получит
						только текст — тогда вставьте ссылку на материал в сообщение ниже.
					</p>
				</div>
			</FormStep>

			<FormStep
				title="Шаг 3. Выдача материала"
				description="После согласий бот спрашивает email этим вопросом, затем сразу отправляет материал: сообщение в чат и письмо с вложением."
			>
				<div className="grid gap-1.5">
					<Label htmlFor="gc-email-question">Вопрос перед сбором email</Label>
					<Textarea
						id="gc-email-question"
						rows={2}
						value={value.emailQuestion}
						onChange={(e) => setAutoText("emailQuestion", e.target.value)}
						placeholder="На какой email отправить материал?"
					/>
					<p className="text-xs text-muted-foreground">
						Свой вопрос для каждой кампании — иначе клиент увидит упоминание
						темы другой кампании или общего гайда из настроек бота.
					</p>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="gc-delivery">Сообщение в чат</Label>
					<Textarea
						id="gc-delivery"
						rows={3}
						value={value.deliveryMessage}
						onChange={(e) => setAutoText("deliveryMessage", e.target.value)}
						placeholder="Спасибо! Данные получили. Сейчас отправим материал на почту..."
					/>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="gc-email-subject">Тема письма</Label>
					<Input
						id="gc-email-subject"
						value={value.emailSubject}
						onChange={(e) => setAutoText("emailSubject", e.target.value)}
					/>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="gc-email-body">Текст письма</Label>
					<Textarea
						id="gc-email-body"
						rows={3}
						value={value.emailBody}
						onChange={(e) => setAutoText("emailBody", e.target.value)}
					/>
				</div>
			</FormStep>

			<FormStep
				title="Шаг 4. Напоминание и приглашение на диагностику"
				description="Бот сам возвращается к клиенту через заданное число дней и предлагает бесплатную 30-минутную диагностику."
			>
				<div className="grid gap-1.5">
					<Label htmlFor="gc-days">Напомнить через, дней</Label>
					<Input
						id="gc-days"
						type="number"
						min={1}
						max={30}
						className="sm:max-w-32"
						value={value.followUpDelayDays}
						onChange={(e) => set("followUpDelayDays", e.target.value)}
					/>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="gc-followup">Текст напоминания</Label>
					<Textarea
						id="gc-followup"
						rows={3}
						value={value.followUpMessage}
						onChange={(e) => setAutoText("followUpMessage", e.target.value)}
						placeholder="Добрый день! Удалось ли вам ознакомиться с материалом?..."
					/>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="gc-cta">Текст кнопки согласия на диагностику</Label>
					<Input
						id="gc-cta"
						value={value.diagnosticCtaText}
						onChange={(e) => set("diagnosticCtaText", e.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						Ответ на согласие общий для всех кампаний — редактируется в блоке
						«Кампании по кодовому слову» → «Заявка на диагностику после гайда».
					</p>
				</div>
			</FormStep>
		</div>
	);
}

/** Смысловой шаг формы кампании — чтобы девять полей читались как путь клиента. */
function FormStep({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="grid gap-3 rounded-lg border p-3">
			<div>
				<p className="text-sm font-medium">{title}</p>
				<p className="text-xs text-muted-foreground">{description}</p>
			</div>
			{children}
		</section>
	);
}

/**
 * У существующей кампании все текстовые поля считаются ручными — их автоматом
 * не переписываем при вводе новой темы.
 */
function initialManualFields(
	campaign?: GuideCampaignView,
): ReadonlySet<AutoTextField> {
	return campaign ? new Set(AUTO_TEXT_FIELDS) : new Set();
}

function GuideCampaignDialog({
	guides,
	campaigns,
	campaign,
	trigger,
}: {
	guides: Array<{ id: string; title: string }>;
	campaigns: GuideCampaignView[];
	campaign?: GuideCampaignView;
	trigger: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [form, setForm] = useState<FormState>(
		campaign ? toForm(campaign) : EMPTY_FORM,
	);
	const [manualFields, setManualFields] = useState<ReadonlySet<AutoTextField>>(
		() => initialManualFields(campaign),
	);
	const queryClient = useQueryClient();

	useEffect(() => {
		if (open) {
			setForm(campaign ? toForm(campaign) : EMPTY_FORM);
			setManualFields(initialManualFields(campaign));
		}
	}, [open, campaign]);

	const otherCampaigns = campaign
		? campaigns.filter((c) => c.id !== campaign.id)
		: campaigns;

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
			toast.error("Через сколько дней напомнить? Укажите число от 1");
			return;
		}
		if (!form.deliveryMessage.trim() || !form.followUpMessage.trim()) {
			toast.error("Заполните сообщение при выдаче и текст напоминания");
			return;
		}
		if (!form.emailSubject.trim() || !form.emailBody.trim()) {
			toast.error("Заполните тему и текст письма");
			return;
		}
		if (!form.emailQuestion.trim()) {
			toast.error("Заполните вопрос перед сбором email");
			return;
		}

		const payload = {
			keyword: form.keyword.trim(),
			title: form.title.trim(),
			guideId: form.guideId || null,
			welcomeMessage: form.welcomeMessage.trim() || null,
			emailQuestion: form.emailQuestion.trim(),
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
						Клиент присылает боту кодовое слово или переходит по ссылке — бот
						сразу ведёт его к согласиям, email и выдаче этого материала, минуя
						обычный выбор темы.
					</DialogDescription>
				</DialogHeader>
				<GuideCampaignForm
					guides={guides}
					otherCampaigns={otherCampaigns}
					value={form}
					onChange={setForm}
					manualFields={manualFields}
					onManualFieldsChange={setManualFields}
					allowClone={!campaign}
				/>
				<DialogFooter>
					<Button type="button" onClick={submit} disabled={pending}>
						{pending ? "Сохраняем…" : campaign ? "Сохранить" : "Создать"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Свёрнутый по умолчанию блок ссылок по рекламным площадкам — не загромождает строку кампании. */
function CampaignSourceLinksToggle({ keyword }: { keyword: string }) {
	const [open, setOpen] = useState(false);
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger asChild>
				<Button
					type="button"
					variant="link"
					size="sm"
					className="h-auto self-start p-0 text-xs"
				>
					{open
						? "Скрыть ссылки по источникам"
						: "Ссылки по источникам рекламы"}
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent className="pt-2">
				<CampaignSourceLinks keyword={keyword} />
			</CollapsibleContent>
		</Collapsible>
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

/** Шаги, которые проходит клиент по кодовому слову — чтобы поля формы читались как путь. */
const CAMPAIGN_PATH_STEPS = [
	"кодовое слово или ссылка",
	"согласия",
	"email",
	"выдача материала",
	"напоминание через N дней",
	"заявка на диагностику",
];

function CampaignPath() {
	return (
		<ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
			{CAMPAIGN_PATH_STEPS.map((step, index) => (
				<li key={step} className="flex items-center gap-1">
					<span className="rounded bg-muted px-1.5 py-0.5">{step}</span>
					{index < CAMPAIGN_PATH_STEPS.length - 1 && <span aria-hidden>→</span>}
				</li>
			))}
		</ol>
	);
}

export function GuideCampaignsCard() {
	const [open, setOpen] = useState(false);
	const { data: campaigns = [] } = useQuery(
		orpc.guideCampaigns.list.queryOptions(),
	);
	const { data: stats = [] } = useQuery(
		orpc.guideCampaigns.stats.queryOptions(),
	);
	const { data: guides = [] } = useQuery(orpc.bot.listGuides.queryOptions());
	const statsById = new Map(stats.map((row) => [row.campaignId, row]));

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
						<div className="flex flex-col gap-2">
							<p className="text-sm text-muted-foreground">
								Клиент присылает боту кодовое слово (например SCHOOL) или
								переходит по готовой ссылке — бот сразу ведёт его к согласиям,
								email и выдаче именно этого материала, минуя обычный выбор темы.
								Через заданное число дней бот сам напоминает о материале и
								предлагает бесплатную диагностику.
							</p>
							<CampaignPath />
						</div>

						<BotUsernamesEditor />

						{campaigns.length > 0 && (
							<div className="flex flex-col gap-2">
								{campaigns.map((campaign) => (
									<div
										key={campaign.id}
										className="flex flex-wrap items-start justify-between gap-4 rounded-lg border p-3"
									>
										<div className="flex min-w-0 flex-1 flex-col gap-1">
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
												Слово «{campaign.keyword}» · напоминание через{" "}
												{campaign.followUpDelayDays} дн. · {(() => {
													const row = statsById.get(campaign.id);
													if (!row || row.delivered === 0) {
														return "материал ещё не выдавался";
													}
													return `выдано ${row.delivered} · напомнили ${row.followUpSent} · заявок на диагностику ${row.diagnosticRequested}`;
												})()}
											</span>
											<CampaignStartLinks keyword={campaign.keyword} />
											<CampaignSourceLinksToggle keyword={campaign.keyword} />
										</div>
										<div className="flex items-center gap-2">
											<GuideCampaignDialog
												guides={guides}
												campaigns={campaigns}
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
							campaigns={campaigns}
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
