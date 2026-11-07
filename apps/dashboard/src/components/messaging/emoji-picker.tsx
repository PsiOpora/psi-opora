"use client";

import { SmileIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

/** Короткий набор для переписки психологического центра: тёплые и нейтральные
 * смайлы, жесты, «галочки» — без внешней библиотеки и без сетевых запросов. */
const EMOJI_GROUPS: Array<{ title: string; items: string[] }> = [
	{
		title: "Лица",
		items: [
			"🙂",
			"😊",
			"😀",
			"😄",
			"😉",
			"🥰",
			"😍",
			"🤗",
			"🙏",
			"😌",
			"🤔",
			"😢",
			"😔",
			"😅",
			"😂",
			"🥲",
		],
	},
	{
		title: "Жесты",
		items: [
			"👍",
			"👌",
			"🙌",
			"👏",
			"🤝",
			"💪",
			"✌️",
			"👋",
			"🤞",
			"☝️",
			"👉",
			"👇",
			"🫶",
			"🤍",
			"❤️",
			"💙",
		],
	},
	{
		title: "Разное",
		items: [
			"✅",
			"☑️",
			"❗",
			"❓",
			"⏰",
			"📅",
			"📍",
			"📞",
			"📝",
			"📎",
			"🌿",
			"🌞",
			"☀️",
			"🌸",
			"✨",
			"🎉",
		],
	},
];

export function EmojiPicker({
	onPick,
	disabled,
}: {
	onPick: (emoji: string) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					title="Смайлики"
					aria-label="Смайлики"
					disabled={disabled}
				>
					<SmileIcon className="size-4 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" side="top" className="w-72 gap-3">
				{EMOJI_GROUPS.map((group) => (
					<div key={group.title} className="flex flex-col gap-1">
						<p className="text-xs text-muted-foreground">{group.title}</p>
						<div className="grid grid-cols-8 gap-0.5">
							{group.items.map((emoji) => (
								<button
									key={emoji}
									type="button"
									className="flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
									onClick={() => {
										onPick(emoji);
										setOpen(false);
									}}
								>
									{emoji}
								</button>
							))}
						</div>
					</div>
				))}
			</PopoverContent>
		</Popover>
	);
}
