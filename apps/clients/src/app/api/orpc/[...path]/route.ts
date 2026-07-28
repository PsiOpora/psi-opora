import { RPCHandler } from "@orpc/server/fetch";
import { appRouter, createORPCContext } from "@psi-opora/api";
import {
  CLIENTS_SESSION_COOKIE,
  verifyBitrixSessionToken,
} from "@psi-opora/bitrix-client";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const handler = new RPCHandler(appRouter);

async function createContext(req: Request) {
  const token = (await cookies()).get(CLIENTS_SESSION_COOKIE)?.value;
  const bitrixSession = verifyBitrixSessionToken(token, "clients");
  return createORPCContext({
    headers: req.headers,
    session: null,
    memberId: bitrixSession?.memberId ?? null,
    bitrixSession,
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
