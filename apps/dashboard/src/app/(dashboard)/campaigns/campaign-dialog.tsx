"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { orpc } from "@/lib/orpc/client";
import { CampaignSourcesField } from "./campaign-sources-field";

export interface MarketingCampaignView {
	id: string;
	code: string;
	title: string;
	sources: string[];
	active: boolean;
}

interface FormState {
	code: string;
	title: string;
	sources: string[];
	active: boolean;
}

const EMPTY_FORM: FormState = {
	code: "",
	title: "",
	sources: [],
	active: true,
};

const CODE_RE = /^[A-Za-z0-9-]{1,24}$/;

function toForm(campaign?: MarketingCampaignView): FormState {
	if (!campaign) return EMPTY_FORM;
	return {
		code: campaign.code,
		title: campaign.title,
		sources: campaign.sources,
		active: campaign.active,
	};
}

export function CampaignDialog({
	campaign,
	trigger,
}: {
	campaign?: MarketingCampaignView;
	trigger: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [form, setForm] = useState<FormState>(toForm(campaign));
	const queryClient = useQueryClient();

	useEffect(() => {
		if (open) setForm(toForm(campaign));
	}, [open, campaign]);

	const onSuccess = (message: string) => {
		toast.success(message);
		setOpen(false);
		queryClient.invalidateQueries({
			queryKey: orpc.marketingCampaigns.list.key(),
		});
	};

	const createMutation = useMutation(
		orpc.marketingCampaigns.create.mutationOptions({
			onSuccess: () => onSuccess("Кампания создана"),
			onError: (error) =>
				toast.error(error.message || "Не удалось создать кампанию"),
		}),
	);
	const updateMutation = useMutation(
		orpc.marketingCampaigns.update.mutationOptions({
			onSuccess: () => onSuccess("Кампания обновлена"),
			onError: (error) =>
				toast.error(error.message || "Не удалось сохранить кампанию"),
		}),
	);
	const pending = createMutation.isPending || updateMutation.isPending;

	const submit = () => {
		const code = form.code.trim();
		if (!CODE_RE.test(code)) {
			toast.error(
				"Кодовое слово: латиница, цифры и «-», без «_» и пробелов (например FREE)",
			);
			return;
		}
		if (!form.title.trim()) {
			toast.error("Укажите название кампании");
			return;
		}
		const payload = {
			code,
			title: form.title.trim(),
			sources: form.sources,
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
						{campaign ? `Кампания «${campaign.title}»` : "Новая кампания"}
					</DialogTitle>
					<DialogDescription>
						Человек переходит по ссылке в бота и видит обычный сценарий. Кодовое
						слово и площадка попадают в сделку Bitrix24 и отчёты по источникам.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<div className="grid gap-1.5">
						<Label htmlFor="mc-title">Название</Label>
						<Input
							id="mc-title"
							value={form.title}
							onChange={(e) => setForm({ ...form, title: e.target.value })}
							placeholder="Бесплатная консультация"
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="mc-code">Кодовое слово</Label>
						<Input
							id="mc-code"
							value={form.code}
							onChange={(e) => setForm({ ...form, code: e.target.value })}
							placeholder="FREE"
						/>
						<p className="text-xs text-muted-foreground">
							Попадёт в ссылку и в UTM-кампанию сделки. Латиница, цифры и «-»,
							без «_».
						</p>
					</div>
					<div className="grid gap-1.5">
						<Label>Площадки</Label>
						<CampaignSourcesField
							value={form.sources}
							onChange={(sources) => setForm({ ...form, sources })}
						/>
						<p className="text-xs text-muted-foreground">
							Для каждой площадки получится своя ссылка вида FREE_vk — так
							видно, откуда пришёл клиент.
						</p>
					</div>
					<div className="flex items-center gap-2 text-sm">
						<Checkbox
							id="mc-active"
							checked={form.active}
							onCheckedChange={(checked) =>
								setForm({ ...form, active: checked === true })
							}
						/>
						<Label htmlFor="mc-active">
							Кампания активна (бот размечает по ней переходы)
						</Label>
					</div>
				</div>
				<DialogFooter>
					<Button type="button" onClick={submit} disabled={pending}>
						{pending ? "Сохраняем…" : campaign ? "Сохранить" : "Создать"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
