import type { WidgetMessenger } from "@psi-opora/api";
import { cn } from "@/lib/utils";

/** Самодостаточные бейджи мессенджеров (кружок + глиф) — для канала переписки
 * во вкладке «Мессенджер» карточки CRM. Тот же рисунок, что и в едином
 * инбоксе дашборда («Клиенты»), см. apps/clients/src/components/inbox/messenger-icon.tsx. */
function TelegramBadge({
	className,
	circleColor,
}: {
	className?: string;
	circleColor: string;
}) {
	return (
		<svg viewBox="0 0 24 24" className={cn(className)} aria-hidden="true">
			<title>Telegram</title>
			<circle cx="12" cy="12" r="10" fill={circleColor} />
			<path
				fill="white"
				d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.27-.89-.88.2-1.31l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.05-2 1.92c-.24.24-.44.44-.9.44z"
			/>
		</svg>
	);
}

function WhatsAppBadge({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={cn(className)} aria-hidden="true">
			<title>WhatsApp</title>
			<circle cx="12" cy="12" r="10" fill="#16A34A" />
			<path
				fill="white"
				d="M16.62 13.29c-.24-.12-1.4-.69-1.62-.77-.22-.08-.37-.12-.53.12-.16.24-.61.77-.75.93-.14.16-.28.18-.51.06-.24-.12-1-.37-1.9-1.17-.7-.63-1.18-1.4-1.32-1.64-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.53-1.29-.73-1.76-.19-.46-.39-.4-.53-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.83.81-.83 1.98s.85 2.3.97 2.46c.12.16 1.67 2.56 4.06 3.59.57.24 1.01.39 1.35.5.57.18 1.09.16 1.5.1.46-.07 1.4-.57 1.6-1.13.2-.55.2-1.03.14-1.13-.06-.1-.22-.16-.46-.27z"
			/>
			<path
				fill="white"
				d="M12.04 4.5c-4.14 0-7.5 3.36-7.5 7.5 0 1.32.35 2.6 1 3.73L4.5 19.5l3.9-1.02a7.47 7.47 0 003.64.94h.01c4.14 0 7.5-3.36 7.5-7.5s-3.36-7.42-7.51-7.42zm0 13.7h-.01a6.2 6.2 0 01-3.16-.87l-.23-.13-2.35.62.63-2.29-.15-.24a6.21 6.21 0 01-.95-3.29c0-3.42 2.79-6.2 6.22-6.2 1.66 0 3.22.65 4.39 1.83a6.16 6.16 0 011.82 4.38c0 3.43-2.78 6.19-6.21 6.19z"
			/>
		</svg>
	);
}

function MaxBadge({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={cn(className)}
			aria-hidden="true"
		>
			<title>MAX</title>
			<rect
				x="2"
				y="2"
				width="20"
				height="20"
				rx="10"
				fill="url(#widget-messenger-icon-max-a)"
			/>
			<rect
				x="2"
				y="2"
				width="20"
				height="20"
				rx="10"
				fill="url(#widget-messenger-icon-max-b)"
				fillOpacity="0.8"
			/>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M12.1289 17.9658C10.9513 17.9658 10.404 17.7931 9.45271 17.1024C8.85099 17.8794 6.94556 18.4866 6.86246 17.4478C6.86246 16.6679 6.69054 16.0089 6.4957 15.2894C6.26361 14.4031 6 13.416 6 11.9858C6 8.56985 8.79082 6 12.0974 6C15.4068 6 18 8.69647 18 12.0174C18.0111 15.287 15.3843 17.9483 12.1289 17.9658ZM12.1776 8.95259C10.5673 8.86913 9.31231 9.98859 9.03437 11.744C8.80515 13.1973 9.21202 14.9671 9.55873 15.0592C9.72492 15.0995 10.1433 14.7599 10.404 14.498C10.8352 14.7972 11.3372 14.9769 11.8596 15.0189C13.5281 15.0995 14.9538 13.8237 15.0659 12.1498C15.1311 10.4723 13.8464 9.05146 12.1776 8.95547L12.1776 8.95259Z"
				fill="white"
			/>
			<defs>
				<linearGradient
					id="widget-messenger-icon-max-a"
					x1="12"
					y1="4"
					x2="21"
					y2="16.5"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#3B49F8" />
					<stop offset="1" stopColor="#9863D6" />
				</linearGradient>
				<linearGradient
					id="widget-messenger-icon-max-b"
					x1="13"
					y1="12"
					x2="4.5"
					y2="21"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#6BC2F8" stopOpacity="0" />
					<stop offset="1" stopColor="#34B9FC" />
				</linearGradient>
			</defs>
		</svg>
	);
}

export function MessengerIcon({
	messenger,
	className,
}: {
	messenger: WidgetMessenger;
	className?: string;
}) {
	switch (messenger) {
		case "telegram":
			return <TelegramBadge className={className} circleColor="#0EA5E9" />;
		case "telegram-personal":
			return <TelegramBadge className={className} circleColor="#10B981" />;
		case "whatsapp-personal":
			return <WhatsAppBadge className={className} />;
		case "max":
			return <MaxBadge className={className} />;
		default:
			return null;
	}
}
