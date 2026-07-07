import { createORPCClient } from "@orpc/client";
import type { AppRouter } from "@psi-opora/api";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";

export const orpc = createORPCClient<AppRouter>({
  url: `${BASE_URL}/api/orpc`,
});
