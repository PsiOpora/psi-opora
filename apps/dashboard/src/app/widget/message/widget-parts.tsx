"use client";

import type { WidgetChannel, WidgetHistoryItem } from "@psi-opora/api";
import { formatDistanceToNowStrict } from "date-fns";
import { ru } from "date-fns/locale";
import { TriangleAlertIcon } from "lucide-react";
import { MessengerIcon } from "@/components/messaging/messenger-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { channelKey } from "./widget-helpers";

/** Выбор канала отправки — в самой карточке ввода, рядом с тем, что пишет
 * менеджер: канал определяет, куда реально уйдёт сообщение. */
export function ChannelPicker({
	channels,
	selected,
	onSelect,
}: {
	channels: WidgetChannel[];
	selected: WidgetChannel | null;
	onSelect: (channel: WidgetChannel) => void;
}) {
	return (
		<fieldset
			aria-label="Канал отправки"
			className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
		>
			<span className="mr-0.5 text-xs text-muted-foreground">
				Отправить через
			</span>
			{channels.map((c) => {
				const isSelected = selected && channelKey(selected) === channelKey(c);
				return (
					<button
						key={channelKey(c)}
						type="button"
						aria-pressed={Boolean(isSelected)}
						title={`Отправить через ${c.label}`}
						onClick={() => onSelect(c)}
						className={cn(
							"inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
							isSelected
								? "border-primary bg-primary text-primary-foreground"
								: "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
						)}
					>
						<MessengerIcon messenger={c.messenger} className="size-4" />
						{c.label}
					</button>
				);
			})}
		</fieldset>
	);
}

/** Как давно клиент писал в канал, отличный от выбранного: так легко ответить
 * не туда, где клиент ждёт ответа. Предупреждаем и предлагаем переключиться. */
export function ChannelMismatchWarning({
	lastIncoming,
	target,
	onSwitch,
}: {
	lastIncoming: WidgetHistoryItem;
	target: WidgetChannel;
	onSwitch: () => void;
}) {
	const ago = formatDistanceToNowStrict(new Date(lastIncoming.createdAt), {
		locale: ru,
		addSuffix: true,
	});
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-sm text-amber-900 dark:text-amber-200">
			<TriangleAlertIcon className="size-4 shrink-0" />
			<p className="min-w-0 flex-1">
				Клиент последний раз писал в {target.label} — {ago}. Ответ уйдёт в
				другой канал.
			</p>
			<Button type="button" variant="outline" size="sm" onClick={onSwitch}>
				<MessengerIcon messenger={target.messenger} className="size-3.5" />
				Переключить на {target.label}
			</Button>
		</div>
	);
}

/** Скелет вместо спиннера: шапка, несколько пузырей и поле ввода — экран не
 * «прыгает», когда данные контакта приходят. */
export function WidgetSkeleton() {
	return (
		<>
			<div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
				<Skeleton className="size-10 rounded-full" />
				<div className="space-y-2">
					<Skeleton className="h-3.5 w-40" />
					<Skeleton className="h-3 w-28" />
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col justify-end gap-3 bg-muted/30 px-4 py-4 sm:px-6">
				<Skeleton className="h-12 w-2/5 rounded-2xl" />
				<Skeleton className="ml-auto h-16 w-1/2 rounded-2xl" />
				<Skeleton className="h-10 w-1/3 rounded-2xl" />
			</div>
			<div className="bg-muted/30 px-4 pb-4 sm:px-6">
				<Skeleton className="h-28 w-full rounded-2xl" />
			</div>
		</>
	);
}
