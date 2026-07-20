import "server-only";

import { createRouterClient } from "@orpc/server";
import { appRouter, createORPCContext } from "@psi-opora/api";
import { MEMBER_ID_COOKIE } from "@psi-opora/bitrix-client";
import { cookies, headers } from "next/headers";

/**
 * Серверный oRPC-клиент: вызывает процедуры in-process, без HTTP-запроса
 * к собственному `/api/orpc`. Использовать в RSC, server actions и route
 * handlers. Для браузера есть `@/lib/orpc/client`.
 *
 * @see https://orpc.dev/docs/client/server-side
 */
export const orpc = createRouterClient(appRouter, {
  context: async () =>
    createORPCContext({
      headers: await headers(),
      session: null,
      memberId: (await cookies()).get(MEMBER_ID_COOKIE)?.value ?? null,
    }),
});
