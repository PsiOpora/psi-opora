import { cn } from "@/lib/utils";

const FALLBACK_COLORS = [
	"bg-rose-700",
	"bg-orange-700",
	"bg-amber-700",
	"bg-emerald-700",
	"bg-teal-700",
	"bg-sky-700",
	"bg-indigo-700",
	"bg-violet-700",
	"bg-fuchsia-700",
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
		FALLBACK_COLORS[hashString(name) % FALLBACK_COLORS.length] ?? "bg-sky-700";
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
