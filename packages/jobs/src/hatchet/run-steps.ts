import type { JsonObject } from "@hatchet-dev/typescript-sdk/v1";

/**
 * Выполняет шаги слитой крон-задачи по очереди, не давая ошибке одного шага
 * заблокировать остальные. Если упал хоть один — после прогона всех бросает
 * ошибку, чтобы Hatchet пометил запуск неуспешным (и сработал retry).
 */
export async function runSteps(
	steps: Record<string, () => Promise<JsonObject>>,
): Promise<JsonObject> {
	const results: JsonObject = {};
	const failures: string[] = [];
	for (const [name, step] of Object.entries(steps)) {
		try {
			results[name] = await step();
		} catch (err) {
			console.error(`[hatchet] шаг ${name}: ${(err as Error).message}`);
			failures.push(`${name}: ${(err as Error).message}`);
		}
	}
	if (failures.length > 0) {
		throw new Error(`Шаги завершились с ошибкой — ${failures.join("; ")}`);
	}
	return results;
}
