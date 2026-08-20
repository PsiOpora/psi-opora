"use client";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouter } from "@psi-opora/api";

/**
 * Браузерный oRPC-клиент поверх `/api/orpc` + утилиты TanStack Query
 * (`orpc.<router>.<procedure>.queryOptions/mutationOptions/key`).
 * На сервере используйте in-process клиент из `@/lib/orpc/server`.
 *
 * @see https://orpc.dev/docs/integrations/tanstack-query
 */
/**
 * Прямой вызываемый клиент (без react-query): `orpcClient.broadcast.send(input)`
 * возвращает Promise, как обычная async-функция. Использовать там, где своя
 * логика состояния (dry-run/подтверждение/поллинг) не ложится на кэш query/mutation.
 */
export const orpcClient = createORPCClient<RouterClient<AppRouter>>(
	new RPCLink({
		url: () => `${window.location.origin}/api/orpc`,
	}),
);

export const orpc = createTanstackQueryUtils(orpcClient);
