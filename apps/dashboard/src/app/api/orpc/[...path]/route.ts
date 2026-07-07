import { fetchRequestHandler } from "@orpc/server/adapters/fetch";
import { appRouter, createORPCContext } from "@psi-opora/api";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/orpc",
    router: appRouter,
    createContext: () =>
      createORPCContext({
        headers: req.headers,
        session: null,
      }),
    getRawRequest: () => req,
  });

export { handler as GET, handler as POST };
