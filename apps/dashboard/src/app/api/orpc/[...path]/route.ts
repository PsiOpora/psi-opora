import { RPCHandler } from "@orpc/server/fetch";
import { appRouter, createORPCContext } from "@psi-opora/api";

const handler = new RPCHandler(appRouter);

export const GET = async (req: Request) => {
  const { response } = await handler.handle(req, {
    context: createORPCContext({
      headers: req.headers,
      session: null,
    }),
  });
  return response ?? new Response("Not found", { status: 404 });
};

export const POST = async (req: Request) => {
  const { response } = await handler.handle(req, {
    context: createORPCContext({
      headers: req.headers,
      session: null,
    }),
  });
  return response ?? new Response("Not found", { status: 404 });
};
