import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@psi-opora/api";
import { env } from "@psi-opora/config";

const BASE_URL = env.BASE_URL ?? env.NEXT_PUBLIC_APP_URL ?? "";

export const orpc = createORPCClient<RouterClient<AppRouter>>(
  new RPCLink({ url: `${BASE_URL}/api/orpc` }),
);
