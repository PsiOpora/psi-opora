import type { InboxMessenger } from "@psi-opora/api";
import { CheckIcon } from "lucide-react";
import { channelDetail } from "@/components/inbox/channel-chip";
import { MessengerIcon } from "@/components/inbox/messenger-icon";
import {
	type ChannelActivity,
	conversationKey,
	messengerMeta,
} from "@/components/inbox/messenger-meta";
import { cn } from "@/lib/utils";

/** Канал, в который оператор может отправить ответ: мессенджер клиента и, для
 * личных номеров, конкретный номер, с которого пишем. */
export interface ReplyChannel {
	messenger: InboxMessenger;
	/** Идентификатор клиента в этом мессенджере — адресат отправки. */
	userId: string;
	/** Только для личных номеров. */
	connectorId?: string;
	/** Наш номер, с которого уйдёт сообщение. */
	accountPhone?: string;
}

export function replyChannelKey(channel: ReplyChannel): string {
	return `${conversationKey(channel.messenger, channel.connectorId)}:${channel.userId}`;
}

/** «сегодня в 14:32», «вчера в 09:10», «12 ноября». */
export function formatWhen(iso: string): string {
	const date = new Date(iso);
	const now = new Date();
	const yesterday = new Date();
	yesterday.setDate(now.getDate() - 1);
	const time = date.toLocaleTimeString("ru-RU", {
		hour: "2-digit",
		minute: "2-digit",
	});
	if (date.toDateString() === now.toDateString()) return `сегодня в ${time}`;
	if (date.toDateString() === yesterday.toDateString())
		return `вчера в ${time}`;
	return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function activityLine(activity: ChannelActivity | undefined): string {
	if (activity?.lastInboundAt) {
		return `клиент писал ${formatWhen(activity.lastInboundAt)}`;
	}
	if (activity?.lastAt) return "клиент здесь пока не отвечал";
	return "переписки ещё не было";
}

/** Выбор канала, через который уйдёт ответ. Стоит прямо над полем ввода —
 * там, где оператор принимает решение, — и у каждого канала подписано, писал ли
 * в нём клиент: отвечать лучше туда, где он активен. */
export function ChannelPicker({
	channels,
	selected,
	activity,
	onSelect,
}: {
	channels: ReplyChannel[];
	selected: ReplyChannel | null;
	activity: Map<string, ChannelActivity>;
	onSelect: (channel: ReplyChannel) => void;
}) {
	const selectedKey = selected ? replyChannelKey(selected) : null;

	return (
		<fieldset className="mb-2.5 min-w-0">
			<legend className="mb-1.5 text-xs font-medium text-muted-foreground">
				Отправить через
			</legend>
			<div className="flex flex-wrap gap-2">
				{channels.map((c) => {
					const key = replyChannelKey(c);
					const meta = messengerMeta(c.messenger);
					const isSelected = key === selectedKey;
					return (
						<button
							key={key}
							type="button"
							aria-pressed={isSelected}
							onClick={() => onSelect(c)}
							className={cn(
								"relative flex min-w-44 items-center gap-2.5 rounded-lg border bg-background py-1.5 pr-8 pl-2.5 text-left transition-colors hover:bg-muted",
								isSelected && meta?.accent.selected,
							)}
						>
							<MessengerIcon
								messenger={c.messenger}
								className="size-6 shrink-0"
							/>
							<span className="min-w-0">
								<span className="block truncate text-sm font-medium">
									{meta?.name ?? c.messenger}
									<span className="font-normal text-muted-foreground">
										{" · "}
										{channelDetail(c.messenger, c.accountPhone)}
									</span>
								</span>
								<span className="block truncate text-xs text-muted-foreground">
									{activityLine(
										activity.get(conversationKey(c.messenger, c.connectorId)),
									)}
								</span>
							</span>
							{isSelected && (
								<CheckIcon
									className={cn(
										"absolute top-1/2 right-2.5 size-4 -translate-y-1/2",
										meta?.accent.text,
									)}
									aria-hidden="true"
								/>
							)}
						</button>
					);
				})}
			</div>
		</fieldset>
	);
}
