import "server-only";

import { createRouterClient } from "@orpc/server";
import { appRouter, createORPCContext } from "@psi-opora/api";
import {
  DASHBOARD_SESSION_COOKIE,
  verifyBitrixSessionToken,
} from "@psi-opora/bitrix-client";
import { cookies, headers } from "next/headers";

/**
 * Серверный oRPC-клиент: вызывает процедуры in-process, без HTTP-запроса
 * к собственному `/api/orpc`. Использовать в RSC, server actions и route
 * handlers. Для браузера есть `@/lib/orpc/client`.
 *
 * @see https://orpc.dev/docs/client/server-side
 */
export const orpc = createRouterClient(appRouter, {
  context: async () => {
    const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    const bitrixSession = verifyBitrixSessionToken(token, "dashboard");
    return createORPCContext({
      headers: await headers(),
      session: null,
      memberId: bitrixSession?.memberId ?? null,
      bitrixSession,
    });
  },
});
