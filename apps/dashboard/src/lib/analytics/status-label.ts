import type { DealStatus } from "./types";

export const STATUS_LABEL: Record<
	DealStatus,
	{ label: string; variant: "default" | "secondary" | "destructive" }
> = {
	won: { label: "Выиграна", variant: "default" },
	lost: { label: "Проиграна", variant: "destructive" },
	in_progress: { label: "В работе", variant: "secondary" },
};
