"use client";

import type { WidgetEntity, WidgetHistoryItem } from "@psi-opora/api";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MessengerIcon } from "@/components/messaging/messenger-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { orpcClient } from "@/lib/orpc/client";

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

interface SearchPopoverProps {
	entity: WidgetEntity;
	entityId: string;
	disabled?: boolean;
	/** Перейти к найденному сообщению в ленте (при необходимости дозагрузив историю). */
	onJump: (item: WidgetHistoryItem) => void;
}

function formatFound(iso: string): string {
	return new Date(iso).toLocaleString("ru-RU", {
		day: "2-digit",
		month: "short",
		year: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Подсвечивает совпадение в сниппете, не используя innerHTML. */
function Highlighted({ text, query }: { text: string; query: string }) {
	const idx = text.toLowerCase().indexOf(query.toLowerCase());
	if (idx === -1) return <>{text}</>;
	const start = Math.max(0, idx - 40);
	const end = Math.min(text.length, idx + query.length + 80);
	return (
		<>
			{start > 0 && "…"}
			{text.slice(start, idx)}
			<mark className="rounded bg-amber-300/60 px-0.5 text-foreground">
				{text.slice(idx, idx + query.length)}
			</mark>
			{text.slice(idx + query.length, end)}
			{end < text.length && "…"}
		</>
	);
}

/** Поиск по тексту всей переписки с клиентом — по всем его каналам. */
export function SearchPopover({
	entity,
	entityId,
	disabled,
	onJump,
}: SearchPopoverProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const [results, setResults] = useState<WidgetHistoryItem[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const timer = setTimeout(
			() => setDebounced(query.trim()),
			SEARCH_DEBOUNCE_MS,
		);
		return () => clearTimeout(timer);
	}, [query]);

	useEffect(() => {
		if (debounced.length < MIN_QUERY_LENGTH) {
			setResults(null);
			setError(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		orpcClient.widgetMessage
			.search({ entity, id: entityId, query: debounced })
			.then((res) => {
				if (cancelled) return;
				if (res.error) setError(res.error);
				setResults(res.messages ?? []);
			})
			.catch((err) => {
				if (!cancelled) setError((err as Error).message);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [debounced, entity, entityId]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={disabled}
					title="Поиск по переписке"
					aria-label="Поиск по переписке"
				>
					<SearchIcon className="size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-96 gap-2">
				<div className="relative">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Найти в переписке"
						aria-label="Найти в переписке"
						className="pl-8"
					/>
				</div>
				<div className="max-h-72 overflow-y-auto" aria-live="polite">
					{loading && (
						<p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
							<Loader2Icon className="size-3.5 animate-spin" />
							Ищем…
						</p>
					)}
					{!loading && error && (
						<p className="px-2 py-3 text-xs text-destructive">{error}</p>
					)}
					{!loading && !error && debounced.length < MIN_QUERY_LENGTH && (
						<p className="px-2 py-3 text-xs text-muted-foreground">
							Введите хотя бы {MIN_QUERY_LENGTH} символа
						</p>
					)}
					{!loading && !error && results && results.length === 0 && (
						<p className="px-2 py-3 text-xs text-muted-foreground">
							Ничего не найдено
						</p>
					)}
					{!loading && results && results.length > 0 && (
						<ul className="flex flex-col gap-0.5">
							{results.map((item) => (
								<li key={item.id}>
									<button
										type="button"
										className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
										onClick={() => {
											onJump(item);
											setOpen(false);
										}}
									>
										<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
											<MessengerIcon
												messenger={item.messenger}
												className="size-3.5"
											/>
											{item.direction === "in" ? "Клиент" : "Мы"} ·{" "}
											{formatFound(item.createdAt)}
										</span>
										<span className="text-sm [overflow-wrap:anywhere]">
											<Highlighted text={item.text} query={debounced} />
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
