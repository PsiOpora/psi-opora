import { bitrixProcedure, router } from "../orpc";
import { addCostSchema } from "../schemas/costs";
import { addCost, deleteCost, listCosts } from "../costs-store";
import { z } from "zod";

export const costsRouter = router({
	list: bitrixProcedure.handler(async () => {
		return listCosts();
	}),

	add: bitrixProcedure.input(addCostSchema).handler(async ({ input }) => {
		await addCost(input);
		return { ok: true };
	}),

	delete: bitrixProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			await deleteCost(input.id);
			return { ok: true };
		}),
});
