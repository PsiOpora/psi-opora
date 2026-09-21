import { env } from "@psi-opora/config";

/** Первое имя — основная модель, остальные — резервные (пробуются по очереди). */
export function getModelNames(): string[] {
	return env.OPENAI_MODELS.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
}
