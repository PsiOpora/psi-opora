import type { WidgetMessenger } from "@psi-opora/api";
import { MessengerIcon } from "@/components/messaging/messenger-icon";
import { messengerMeta } from "@/components/messaging/messenger-meta";
import { cn } from "@/lib/utils";

/** Пояснение к каналу: «бот» или «личный номер 7900···12». */
export function channelDetail(
	messenger: WidgetMessenger,
	accountPhone?: string,
): string {
	const meta = messengerMeta(messenger);
	if (!meta || meta.kind === "bot") return "бот";
	return accountPhone ? `личный номер ${accountPhone}` : "личный номер";
}

/** Цветной бейдж канала: значок мессенджера, название и пояснение. Один и тот
 * же вид — в шапке, в выборе канала, в разделителях истории и у поля ввода,
 * чтобы менеджер узнавал канал по цвету, не читая подпись. */
export function ChannelChip({
	messenger,
	accountPhone,
	className,
}: {
	messenger: WidgetMessenger;
	accountPhone?: string;
	className?: string;
}) {
	const meta = messengerMeta(messenger);
	if (!meta) return null;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1.5 text-xs",
				meta.accent.chip,
				className,
			)}
		>
			<MessengerIcon messenger={messenger} className="size-4 shrink-0" />
			<span className="font-medium">{meta.name}</span>
			<span className="opacity-75">
				{channelDetail(messenger, accountPhone)}
			</span>
		</span>
	);
}
