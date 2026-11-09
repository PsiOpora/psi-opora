"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AD_SOURCE_PRESETS } from "../settings/bot/bot-links";

const SOURCE_RE = /^[A-Za-z0-9_-]{1,39}$/;

/** Площадки кампании: быстрые кнопки с пресетами + свой код (vk, b17, dzen…). */
export function CampaignSourcesField({
	value,
	onChange,
}: {
	value: string[];
	onChange: (next: string[]) => void;
}) {
	const [draft, setDraft] = useState("");
	const trimmed = draft.trim();
	const invalid = trimmed.length > 0 && !SOURCE_RE.test(trimmed);

	const has = (code: string) =>
		value.some((item) => item.toLowerCase() === code.toLowerCase());

	const add = (code: string) => {
		const next = code.trim();
		if (!SOURCE_RE.test(next) || has(next)) return;
		onChange([...value, next]);
		setDraft("");
	};

	return (
		<div className="grid gap-2">
			{value.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{value.map((source) => (
						<Badge key={source} variant="secondary" className="gap-1">
							{source}
							<button
								type="button"
								aria-label={`Убрать площадку ${source}`}
								onClick={() =>
									onChange(value.filter((item) => item !== source))
								}
							>
								<X className="size-3" />
							</button>
						</Badge>
					))}
				</div>
			)}
			<div className="flex flex-wrap gap-1.5">
				{AD_SOURCE_PRESETS.filter((preset) => !has(preset.code)).map(
					(preset) => (
						<Button
							key={preset.code}
							type="button"
							variant="outline"
							size="sm"
							className="h-7 text-xs"
							onClick={() => add(preset.code)}
						>
							<Plus data-icon="inline-start" />
							{preset.label}
						</Button>
					),
				)}
			</div>
			<div className="flex items-center gap-2">
				<Input
					className="h-8 max-w-52 text-xs"
					value={draft}
					placeholder="свой код площадки, например b17"
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							add(draft);
						}
					}}
				/>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={!trimmed || invalid}
					onClick={() => add(draft)}
				>
					Добавить
				</Button>
			</div>
			{invalid && (
				<p className="text-xs text-destructive">
					Код площадки: латиница, цифры, «_» и «-».
				</p>
			)}
		</div>
	);
}
