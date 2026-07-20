import { RPCHandler } from "@orpc/server/fetch";
import { appRouter, createORPCContext } from "@psi-opora/api";
import { MEMBER_ID_COOKIE } from "@psi-opora/bitrix-client";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const handler = new RPCHandler(appRouter);

async function createContext(req: Request) {
  return createORPCContext({
    headers: req.headers,
    session: null,
    memberId: (await cookies()).get(MEMBER_ID_COOKIE)?.value ?? null,
  });
}

export const GET = async (req: Request) => {
  const { response } = await handler.handle(req, {
    prefix: "/api/orpc",
    context: await createContext(req),
  });
  return response ?? new Response("Not found", { status: 404 });
};

export const POST = async (req: Request) => {
  const { response } = await handler.handle(req, {
    prefix: "/api/orpc",
    context: await createContext(req),
  });
  return response ?? new Response("Not found", { status: 404 });
};
