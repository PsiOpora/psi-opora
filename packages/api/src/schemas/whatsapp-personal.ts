import { z } from "zod";

export const startWhatsappLoginSchema = z.object({
	lineId: z.string(),
	/** Коннектор этого конкретного слота (см. wa-personal-connector-card.tsx) —
	 * передаётся Bitrix24 через PLACEMENT_OPTIONS.CONNECTOR при открытии
	 * настроек канала на линии. */
	connectorId: z.string(),
	phone: z.string().min(5),
});
export type StartWhatsappLoginInput = z.infer<typeof startWhatsappLoginSchema>;

export const pollWhatsappStatusSchema = z.object({
	lineId: z.string(),
	connectorId: z.string(),
	phone: z.string().min(5),
});
export type PollWhatsappStatusInput = z.infer<typeof pollWhatsappStatusSchema>;

export const disconnectWhatsappPersonalSchema = z.object({
	lineId: z.string(),
	connectorId: z.string(),
});
export type DisconnectWhatsappPersonalInput = z.infer<
	typeof disconnectWhatsappPersonalSchema
>;
