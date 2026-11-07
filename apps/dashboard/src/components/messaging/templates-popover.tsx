"use client";

import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import {
	ArrowLeftIcon,
	BookmarkPlusIcon,
	Loader2Icon,
	MessageSquareQuoteIcon,
	PencilIcon,
	SearchIcon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { orpcClient } from "@/lib/orpc/client";
import { TEMPLATE_VARIABLES_HINT } from "./template-variables";

export interface TemplateItem {
	id: string;
	title: string;
	text: string;
}

interface TemplatesPopoverProps {
	templates: TemplateItem[];
	loading?: boolean;
	/** Текст из поля ввода — предлагаем сохранить его как новый шаблон. */
	currentText: string;
	disabled?: boolean;
	onInsert: (template: TemplateItem) => void;
	/** После создания/правки/удаления — перечитать список. */
	onChanged: () => void;
}

type Mode = { kind: "list" } | { kind: "edit"; id?: string };

/** Быстрые ответы — общие на всю команду (те же, что в инбоксе «Клиенты»). */
export function TemplatesPopover({
	templates,
	loading,
	currentText,
	disabled,
	onInsert,
	onChanged,
}: TemplatesPopoverProps) {
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<Mode>({ kind: "list" });
	const [search, setSearch] = useState("");
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [busy, setBusy] = useState(false);

	const query = search.trim().toLowerCase();
	const visible = query
		? templates.filter(
				(t) =>
					t.title.toLowerCase().includes(query) ||
					t.text.toLowerCase().includes(query),
			)
		: templates;

	const startEdit = (item?: TemplateItem) => {
		setMode({ kind: "edit", id: item?.id });
		setTitle(item?.title ?? "");
		setBody(item?.text ?? currentText.trim());
	};

	const save = async () => {
		if (busy) return;
		const trimmedTitle = title.trim();
		const trimmedBody = body.trim();
		if (!trimmedTitle || !trimmedBody) {
			toast.error("Заполните название и текст шаблона");
			return;
		}
		setBusy(true);
		try {
			await orpcClient.messages.saveQuickReply({
				id: mode.kind === "edit" ? mode.id : undefined,
				title: trimmedTitle,
				text: trimmedBody,
			});
			toast.success("Шаблон сохранён");
			onChanged();
			setMode({ kind: "list" });
		} catch {
			toast.error("Не удалось сохранить шаблон");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (item: TemplateItem) => {
		if (busy) return;
		setBusy(true);
		try {
			await orpcClient.messages.deleteQuickReply({ id: item.id });
			toast.success("Шаблон удалён");
			onChanged();
		} catch {
			toast.error("Не удалось удалить шаблон");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setMode({ kind: "list" });
					setSearch("");
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					title="Шаблоны ответов"
					className="text-muted-foreground"
				>
					<MessageSquareQuoteIcon className="size-4" />
					Шаблоны
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" side="top" className="w-96 gap-2">
				{mode.kind === "list" ? (
					<>
						<div className="flex items-center gap-2">
							<div className="relative flex-1">
								<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Найти шаблон"
									aria-label="Найти шаблон"
									className="pl-8"
								/>
							</div>
							<Button
								type="button"
								variant="outline"
								onClick={() => startEdit()}
								title={
									currentText.trim()
										? "Сохранить написанное как шаблон"
										: "Новый шаблон"
								}
							>
								<BookmarkPlusIcon className="size-4" />
								Новый
							</Button>
						</div>
						<ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
							{loading && (
								<li className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
									<Loader2Icon className="size-3.5 animate-spin" />
									Загружаем шаблоны…
								</li>
							)}
							{!loading && visible.length === 0 && (
								<li className="px-2 py-4 text-center text-xs text-muted-foreground">
									{templates.length === 0
										? "Шаблонов пока нет. Напишите сообщение и нажмите «Новый», чтобы сохранить его."
										: "Ничего не найдено"}
								</li>
							)}
							{visible.map((item) => (
								<li
									key={item.id}
									className="group flex items-start gap-1 rounded-md hover:bg-muted"
								>
									<button
										type="button"
										className="flex min-w-0 flex-1 flex-col items-start px-2 py-1.5 text-left"
										onClick={() => {
											onInsert(item);
											setOpen(false);
										}}
									>
										<span className="text-sm font-medium">{item.title}</span>
										<span className="line-clamp-2 text-xs text-muted-foreground">
											{item.text}
										</span>
									</button>
									<div className="flex shrink-0 gap-0.5 p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											title="Изменить шаблон"
											aria-label="Изменить шаблон"
											onClick={() => startEdit(item)}
										>
											<PencilIcon />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											title="Удалить шаблон"
											aria-label="Удалить шаблон"
											disabled={busy}
											onClick={() => void remove(item)}
										>
											<Trash2Icon />
										</Button>
									</div>
								</li>
							))}
						</ul>
					</>
				) : (
					<>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								title="Назад к списку"
								aria-label="Назад к списку"
								onClick={() => setMode({ kind: "list" })}
							>
								<ArrowLeftIcon />
							</Button>
							<p className="text-sm font-medium">
								{mode.id ? "Изменить шаблон" : "Новый шаблон"}
							</p>
						</div>
						<Input
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Название, например «Адрес центра»"
							aria-label="Название шаблона"
							maxLength={80}
						/>
						<textarea
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="Текст сообщения"
							aria-label="Текст шаблона"
							maxLength={MESSAGE_MAX_LENGTH}
							rows={5}
							className="w-full resize-none rounded-lg border bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
						/>
						<p className="text-xs text-muted-foreground">
							Переменные: {TEMPLATE_VARIABLES_HINT}
						</p>
						<Button type="button" disabled={busy} onClick={() => void save()}>
							{busy && <Loader2Icon className="size-4 animate-spin" />}
							Сохранить
						</Button>
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
