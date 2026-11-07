"use client";

import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import { BoldIcon, CodeIcon, ItalicIcon, Link2Icon } from "lucide-react";
import type * as React from "react";
import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Кнопки разметки соответствуют «легаси» Markdown Telegram, с которым
 * реально отправляются сообщения (см. packages/jobs/src/messenger.ts):
 * *жирный*, _курсив_, `код`, [текст](ссылка) — без **, __ и других вариантов.
 */
const MARKDOWN_ACTIONS: Array<{
	label: string;
	icon: typeof BoldIcon;
	before: string;
	after: string;
	placeholder: string;
}> = [
	{
		label: "Жирный",
		icon: BoldIcon,
		before: "*",
		after: "*",
		placeholder: "жирный текст",
	},
	{
		label: "Курсив",
		icon: ItalicIcon,
		before: "_",
		after: "_",
		placeholder: "курсив",
	},
	{ label: "Код", icon: CodeIcon, before: "`", after: "`", placeholder: "код" },
];

/** Счётчик символов появляется, только когда лимит уже близко. */
const COUNTER_VISIBLE_RATIO = 0.8;

export interface MessageComposerProps {
	text: string;
	onTextChange: (text: string) => void;
	onSend: () => void;
	placeholder?: string;
	className?: string;
	disabled?: boolean;
	/** Верхняя полоса карточки — например, выбор канала отправки. */
	header?: React.ReactNode;
	/** Кнопки справа в нижней строке (отложить, отправить). */
	actions?: React.ReactNode;
	/** Подсказка под карточкой; ошибка отправки заменяет её. */
	error?: string | null;
}

/** Карточка ввода: textarea растёт вместе с текстом, под ней — разметка слева
 * и действия справа. Enter отправляет, Shift+Enter — перенос строки. Общая
 * часть вкладки CRM «Мессенджер» (widget-message). */
export function MessageComposer({
	text,
	onTextChange,
	onSend,
	placeholder,
	className,
	disabled,
	header,
	actions,
	error,
}: MessageComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const wrapSelection = useCallback(
		(before: string, after: string, placeholderText: string) => {
			const el = textareaRef.current;
			const start = el?.selectionStart ?? text.length;
			const end = el?.selectionEnd ?? text.length;
			const selected = text.slice(start, end) || placeholderText;
			const next =
				text.slice(0, start) + before + selected + after + text.slice(end);
			onTextChange(next);
			requestAnimationFrame(() => {
				el?.focus();
				el?.setSelectionRange(
					start + before.length,
					start + before.length + selected.length,
				);
			});
		},
		[text, onTextChange],
	);

	const insertLink = useCallback(() => {
		const el = textareaRef.current;
		const start = el?.selectionStart ?? text.length;
		const end = el?.selectionEnd ?? text.length;
		const label = text.slice(start, end) || "текст ссылки";
		const url = "https://";
		const next = `${text.slice(0, start)}[${label}](${url})${text.slice(end)}`;
		onTextChange(next);
		const urlStart = start + label.length + 3;
		requestAnimationFrame(() => {
			el?.focus();
			el?.setSelectionRange(urlStart, urlStart + url.length);
		});
	}, [text, onTextChange]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		// isComposing — Enter внутри IME-ввода не должен отправлять сообщение
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			onSend();
		}
	};

	const length = text.trim().length;
	const overLimit = length > MESSAGE_MAX_LENGTH;
	const showCounter = length >= MESSAGE_MAX_LENGTH * COUNTER_VISIBLE_RATIO;

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div
				className={cn(
					"overflow-hidden rounded-2xl border bg-background shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
					disabled && "opacity-60",
					overLimit && "border-destructive focus-within:border-destructive",
				)}
			>
				{header && (
					<div className="border-b bg-muted/40 px-3 py-2">{header}</div>
				)}
				<textarea
					ref={textareaRef}
					value={text}
					disabled={disabled}
					onChange={(e) => onTextChange(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					rows={2}
					aria-label="Текст сообщения"
					className="block max-h-[40svh] min-h-[3.5rem] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed outline-none field-sizing-content placeholder:text-muted-foreground disabled:cursor-not-allowed"
				/>
				<div className="flex items-center gap-1 px-2 pb-2">
					<div className="flex items-center gap-0.5">
						{MARKDOWN_ACTIONS.map(
							({ label, icon: Icon, before, after, placeholder: ph }) => (
								<Button
									key={label}
									type="button"
									variant="ghost"
									size="icon-sm"
									title={label}
									aria-label={label}
									disabled={disabled}
									onClick={() => wrapSelection(before, after, ph)}
								>
									<Icon className="size-4 text-muted-foreground" />
								</Button>
							),
						)}
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							title="Ссылка"
							aria-label="Ссылка"
							disabled={disabled}
							onClick={insertLink}
						>
							<Link2Icon className="size-4 text-muted-foreground" />
						</Button>
					</div>
					{showCounter && (
						<span
							className={cn(
								"ml-2 text-xs tabular-nums",
								overLimit ? "text-destructive" : "text-muted-foreground",
							)}
						>
							{length} / {MESSAGE_MAX_LENGTH}
						</span>
					)}
					<div className="ml-auto flex items-center gap-1.5">{actions}</div>
				</div>
			</div>
			<p
				className={cn(
					"min-h-4 px-1 text-xs",
					error || overLimit ? "text-destructive" : "text-muted-foreground",
				)}
				role={error ? "alert" : undefined}
			>
				{error ??
					(overLimit
						? "Мессенджеры не примут такое длинное сообщение — сократите текст"
						: "Enter — отправить, Shift+Enter — новая строка")}
			</p>
		</div>
	);
}

export { MESSAGE_MAX_LENGTH };
