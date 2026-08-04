import { z } from "zod";

export const startMaxLoginSchema = z.object({
	lineId: z.string().min(1),
	connectorId: z.string().min(1),
	phone: z.string().min(5),
});
export type StartMaxLoginInput = z.infer<typeof startMaxLoginSchema>;

export const submitMaxCodeSchema = z.object({
	loginId: z.string().min(1),
	code: z.string().min(1),
});
export type SubmitMaxCodeInput = z.infer<typeof submitMaxCodeSchema>;

export const disconnectMaxPersonalSchema = z.object({
	lineId: z.string().min(1),
	connectorId: z.string().min(1),
});
export type DisconnectMaxPersonalInput = z.infer<
	typeof disconnectMaxPersonalSchema
>;
