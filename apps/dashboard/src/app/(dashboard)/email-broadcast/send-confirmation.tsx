"use client";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { RecentEmailCampaignInfo } from "@psi-opora/api";
import { LARGE_AUDIENCE_THRESHOLD } from "@psi-opora/api/schemas";
import { WarningBox } from "@/components/messaging/warning-box";

function formatDateTime(date: Date | null): string {
	if (!date) return "—";
	return new Intl.DateTimeFormat("ru-RU", {
		dateStyle: "short",
		timeStyle: "short",
	}).format(new Date(date));
}

export function SendConfirmation({
	stageLabel,
	templateLabel,
	subject,
	sendableCount,
	hasManualSelection,
	skippedCount,
	recentCampaign,
	ackChecked,
	onAckChange,
	onConfirm,
	onCancel,
	isPending,
}: {
	stageLabel: string;
	templateLabel: string;
	subject: string;
	sendableCount: number;
	hasManualSelection: boolean;
	skippedCount: number;
	recentCampaign: RecentEmailCampaignInfo | null;
	ackChecked: boolean;
	onAckChange: (checked: boolean) => void;
	onConfirm: () => void;
	onCancel: () => void;
	isPending: boolean;
}) {
	return (
		<Card className="border-destructive/50">
			<CardHeader>
				<CardTitle>Подтверждение отправки</CardTitle>
				<CardDescription>
					Проверьте всё ещё раз — отменить рассылку после запуска невозможно.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div className="text-sm">
					<p>
						<span className="text-muted-foreground">Стадия:</span> {stageLabel}
					</p>
					<p>
						<span className="text-muted-foreground">Шаблон:</span>{" "}
						{templateLabel}
					</p>
					<p>
						<span className="text-muted-foreground">Тема:</span> {subject}
					</p>
					<p>
						<span className="text-muted-foreground">Получат письмо:</span>{" "}
						{sendableCount} контактов
						{hasManualSelection
							? " (отмечены вручную, остальные пропущены)"
							: ""}
						{skippedCount > 0 &&
							` (ещё ${skippedCount} будут пропущены — нет email или отписаны)`}
					</p>
				</div>

				{recentCampaign && (
					<WarningBox>
						По этой стадии уже была email-рассылка{" "}
						{formatDateTime(recentCampaign.startedAt)} (получателей:{" "}
						{recentCampaign.recipientsCount ?? "—"}). Убедитесь, что не
						отправляете то же самое повторно.
					</WarningBox>
				)}
				{sendableCount > LARGE_AUDIENCE_THRESHOLD && (
					<WarningBox>
						Большая аудитория: {sendableCount} получателей. Рекомендуем сначала
						отправить тест себе кнопкой «Тест» в предпросмотре.
					</WarningBox>
				)}

				<label className="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						checked={ackChecked}
						onChange={(e) => onAckChange(e.target.checked)}
						className="mt-0.5"
					/>
					<span>
						Я проверил(а) список получателей, тему и шаблон письма. Понимаю, что
						письмо уйдёт реальным клиентам через Unisender.
					</span>
				</label>

				<div className="flex gap-2">
					<Button
						variant="destructive"
						disabled={!ackChecked || isPending}
						onClick={onConfirm}
					>
						{isPending ? "Отправка…" : `Отправить ${sendableCount} писем`}
					</Button>
					<Button variant="outline" disabled={isPending} onClick={onCancel}>
						Отмена
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
