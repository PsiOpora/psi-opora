"use client";

import { BoldIcon, CodeIcon, ItalicIcon, LinkIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";

/**
 * Оборачивает выделенный текст в разметку Telegram (легаси-Markdown,
 * тот же режим используют боты проекта: *…*, _…_, `…`, [текст](url)).
 */
export function MessageEditor({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const trimmed = value.trim();
	const overLimit = trimmed.length > MESSAGE_MAX_LENGTH;

	const applyFormat = (kind: "bold" | "italic" | "code" | "link") => {
		const el = textareaRef.current;
		if (!el) return;
		const start = el.selectionStart ?? value.length;
		const end = el.selectionEnd ?? value.length;
		const selected = value.slice(start, end);

		let inserted: string;
		let selectFrom: number;
		let selectTo: number;
		if (kind === "link") {
			const label = selected || "текст ссылки";
			const url = "https://";
			inserted = `[${label}](${url})`;
			// выделяем URL-заглушку, чтобы сразу вписать адрес
			selectFrom = start + label.length + 3;
			selectTo = selectFrom + url.length;
		} else {
			const marker = kind === "bold" ? "*" : kind === "italic" ? "_" : "`";
			const label =
				selected ||
				(kind === "bold" ? "жирный" : kind === "italic" ? "курсив" : "код");
			inserted = `${marker}${label}${marker}`;
			selectFrom = start + 1;
			selectTo = selectFrom + label.length;
		}

		onChange(value.slice(0, start) + inserted + value.slice(end));
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(selectFrom, selectTo);
		});
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<Label htmlFor="message" className="text-xs text-muted-foreground">
					Текст сообщения
				</Label>
				<div className="flex items-center gap-0.5">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						title="Жирный — *текст*"
						onClick={() => applyFormat("bold")}
					>
						<BoldIcon className="size-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						title="Курсив — _текст_"
						onClick={() => applyFormat("italic")}
					>
						<ItalicIcon className="size-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						title="Моноширинный — `текст`"
						onClick={() => applyFormat("code")}
					>
						<CodeIcon className="size-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						title="Ссылка — [текст](https://…)"
						onClick={() => applyFormat("link")}
					>
						<LinkIcon className="size-4" />
					</Button>
				</div>
			</div>
			<textarea
				id="message"
				ref={textareaRef}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				rows={8}
				placeholder="Здравствуйте! Напоминаем о записи на консультацию…"
				className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full flex-1 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
			/>
			<span
				className={`text-xs ${overLimit ? "text-destructive" : "text-muted-foreground"}`}
			>
				{trimmed.length} / {MESSAGE_MAX_LENGTH}
				{overLimit && " — мессенджеры не примут такое длинное сообщение"}
			</span>
			<p className="text-xs text-muted-foreground">
				Разметка Telegram: *жирный* _курсив_ `код` [ссылка](https://…). MAX
				получит то же форматирование.
			</p>
		</div>
	);
}
