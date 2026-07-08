import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@psi-opora/api";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";

export const orpc = createORPCClient<RouterClient<AppRouter>>(
  new RPCLink({ url: `${BASE_URL}/api/orpc` }),
);
