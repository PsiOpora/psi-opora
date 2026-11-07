"use client";

import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import {
	BoldIcon,
	CodeIcon,
	ItalicIcon,
	Link2Icon,
	PaperclipIcon,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmojiPicker } from "@/components/messaging/emoji-picker";
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

export interface SlashItem {
	id: string;
	title: string;
	text: string;
}

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
	/** Дополнительные кнопки слева после разметки (шаблоны и т.п.). */
	toolbarExtra?: React.ReactNode;
	/** Подсказка под карточкой; ошибка отправки заменяет её. */
	error?: string | null;
	/** Выбор файла: скрепка, перетаскивание на карточку и вставка из буфера. */
	onPickFile?: (file: File) => void;
	/** Превью выбранного вложения — над полем текста. */
	attachmentPreview?: React.ReactNode;
	/** Шаблоны для быстрой вставки по «/»: набираете «/при» — видите подходящие. */
	slashItems?: SlashItem[];
	onSlashPick?: (item: SlashItem) => void;
	/** Внешний ref на textarea — чтобы сфокусировать поле после цитаты/шаблона. */
	textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
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
	toolbarExtra,
	error,
	onPickFile,
	attachmentPreview,
	slashItems,
	onSlashPick,
	textareaRef: externalRef,
}: MessageComposerProps) {
	const localRef = useRef<HTMLTextAreaElement>(null);
	const textareaRef = externalRef ?? localRef;
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const [slashIndex, setSlashIndex] = useState(0);
	const [slashDismissed, setSlashDismissed] = useState(false);

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
		[text, onTextChange, textareaRef],
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
	}, [text, onTextChange, textareaRef]);

	const insertAtCursor = useCallback(
		(value: string) => {
			const el = textareaRef.current;
			const start = el?.selectionStart ?? text.length;
			const end = el?.selectionEnd ?? text.length;
			onTextChange(text.slice(0, start) + value + text.slice(end));
			requestAnimationFrame(() => {
				el?.focus();
				el?.setSelectionRange(start + value.length, start + value.length);
			});
		},
		[text, onTextChange, textareaRef],
	);

	// «/» в начале однострочного текста открывает подсказки шаблонов
	const slashQuery = /^\/([^\s/]*)$/.exec(text)?.[1]?.toLowerCase();
	const slashMatches =
		slashQuery === undefined || !slashItems || slashDismissed
			? []
			: slashItems
					.filter((item) => item.title.toLowerCase().includes(slashQuery))
					.slice(0, 6);
	const slashOpen = slashMatches.length > 0 && Boolean(onSlashPick);

	// Новый запрос — выбор снова с первого пункта, закрытое меню открывается заново
	// biome-ignore lint/correctness/useExhaustiveDependencies: сброс именно по смене запроса
	useEffect(() => {
		setSlashIndex(0);
		setSlashDismissed(false);
	}, [slashQuery]);

	const pickSlash = (item: SlashItem) => {
		onSlashPick?.(item);
		requestAnimationFrame(() => textareaRef.current?.focus());
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (slashOpen) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const step = e.key === "ArrowDown" ? 1 : -1;
				setSlashIndex(
					(i) => (i + step + slashMatches.length) % slashMatches.length,
				);
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				const item = slashMatches[slashIndex];
				if (item) {
					e.preventDefault();
					pickSlash(item);
					return;
				}
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setSlashDismissed(true);
				return;
			}
		}
		// keyCode 229 — Enter, подтверждающий IME-ввод в Safari: keydown приходит уже
		// после compositionend, когда isComposing снова false
		if (
			e.key === "Enter" &&
			!e.shiftKey &&
			!e.nativeEvent.isComposing &&
			e.keyCode !== 229
		) {
			e.preventDefault();
			onSend();
		}
	};

	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const file = e.clipboardData.files[0];
		if (file && onPickFile) {
			e.preventDefault();
			onPickFile(file);
		}
	};

	const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
		setDragging(false);
		const file = e.dataTransfer.files[0];
		if (file && onPickFile && !disabled) {
			e.preventDefault();
			onPickFile(file);
		}
	};

	const length = text.trim().length;
	const overLimit = length > MESSAGE_MAX_LENGTH;
	const showCounter = length >= MESSAGE_MAX_LENGTH * COUNTER_VISIBLE_RATIO;

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: контейнер лишь принимает перетаскиваемый файл, действие доступно и через скрепку */}
			<div
				onDragOver={(e) => {
					if (
						onPickFile &&
						!disabled &&
						e.dataTransfer.types.includes("Files")
					) {
						e.preventDefault();
						setDragging(true);
					}
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={handleDrop}
				className={cn(
					"relative overflow-hidden rounded-2xl border bg-background shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
					disabled && "opacity-60",
					overLimit && "border-destructive focus-within:border-destructive",
					dragging && "border-primary ring-3 ring-primary/30",
				)}
			>
				{dragging && (
					<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm font-medium text-primary">
						Отпустите файл, чтобы прикрепить
					</div>
				)}
				{header && (
					<div className="border-b bg-muted/40 px-3 py-2">{header}</div>
				)}
				{slashOpen && (
					<ul
						aria-label="Шаблоны ответов"
						className="max-h-48 overflow-y-auto border-b bg-muted/30 p-1"
					>
						{slashMatches.map((item, index) => (
							<li key={item.id}>
								<button
									type="button"
									aria-current={index === slashIndex}
									onMouseEnter={() => setSlashIndex(index)}
									onClick={() => pickSlash(item)}
									className={cn(
										"flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
										index === slashIndex ? "bg-muted" : "hover:bg-muted/60",
									)}
								>
									<span className="font-medium">{item.title}</span>
									<span className="line-clamp-1 text-xs text-muted-foreground">
										{item.text}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
				{attachmentPreview && (
					<div className="px-3 pt-3">{attachmentPreview}</div>
				)}
				<textarea
					ref={textareaRef}
					value={text}
					disabled={disabled}
					onChange={(e) => onTextChange(e.target.value)}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste}
					placeholder={placeholder}
					rows={2}
					aria-label="Текст сообщения"
					className="block max-h-[40svh] min-h-[3.5rem] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed outline-none field-sizing-content placeholder:text-muted-foreground disabled:cursor-not-allowed"
				/>
				<div className="flex flex-wrap items-center gap-1 px-2 pb-2">
					<div className="flex items-center gap-0.5">
						{onPickFile && (
							<>
								<input
									ref={fileInputRef}
									type="file"
									className="hidden"
									tabIndex={-1}
									onChange={(e) => {
										const file = e.target.files?.[0];
										if (file) onPickFile(file);
										e.target.value = "";
									}}
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									title="Прикрепить фото или файл"
									aria-label="Прикрепить фото или файл"
									disabled={disabled}
									onClick={() => fileInputRef.current?.click()}
								>
									<PaperclipIcon className="size-4 text-muted-foreground" />
								</Button>
							</>
						)}
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
						<EmojiPicker onPick={insertAtCursor} disabled={disabled} />
						{toolbarExtra}
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
					<div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
						{actions}
					</div>
				</div>
			</div>
			<p
				className={cn(
					"min-h-4 px-1 text-xs",
					error || overLimit ? "text-destructive" : "text-muted-foreground",
				)}
				aria-live="polite"
			>
				{error ??
					(overLimit
						? "Мессенджеры не примут такое длинное сообщение — сократите текст"
						: "Enter — отправить, Shift+Enter — новая строка. «/» — шаблоны")}
			</p>
		</div>
	);
}

export { MESSAGE_MAX_LENGTH };
