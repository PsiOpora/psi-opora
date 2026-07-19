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
const client = createORPCClient<RouterClient<AppRouter>>(
  new RPCLink({
    url: () => `${window.location.origin}/api/orpc`,
  }),
);

export const orpc = createTanstackQueryUtils(client);
