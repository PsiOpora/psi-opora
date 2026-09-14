import { cn } from "@/lib/utils";

const FALLBACK_COLORS = [
	"bg-rose-500",
	"bg-orange-500",
	"bg-amber-500",
	"bg-emerald-500",
	"bg-teal-500",
	"bg-sky-500",
	"bg-indigo-500",
	"bg-violet-500",
	"bg-fuchsia-500",
];

function hashString(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	const first = parts[0]?.[0] ?? "?";
	const second = parts[1]?.[0] ?? "";
	return (first + second).toUpperCase();
}

/** Аватар контакта во вкладке «Мессенджер» карточки CRM — только инициалы
 * (WidgetRecipient не отдаёт ссылку на фото), цвет детерминирован именем. */
export function ContactAvatar({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	const color =
		FALLBACK_COLORS[hashString(name) % FALLBACK_COLORS.length] ?? "bg-sky-500";
	return (
		<div
			className={cn(
				"flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white",
				color,
				className,
			)}
		>
			{initials(name)}
		</div>
	);
}
