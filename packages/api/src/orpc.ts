/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for an oRPC context. The API handler and RSC clients each
 * wrap this and provide the required context.
 *
 * The context is intentionally decoupled from any concrete `better-auth` instance: callers resolve
 * the session themselves (via `auth.api.getSession`) and pass it in. This keeps `@psi-opora/api` free of
 * the `Auth` type, which previously caused cross-package type mismatches when `better-auth` resolved
 * to more than one instance in the workspace.
 *
 * @see https://orpc.dev/docs/server/context
 */

import { ORPCError, os } from "@orpc/server";
import {
  type BitrixApi,
  resolveBitrixApiForRequest,
} from "@psi-opora/bitrix-client";
import { env, logger } from "@psi-opora/config";
import { db } from "@psi-opora/db";

export interface CreateORPCContextOptions {
  /** Request headers, kept on the context for procedures that need them. */
  headers: Headers;
  /** Pre-resolved session (or `null` for anonymous requests). */
  session: { user: { id: string; email: string; name: string } } | null;
  /**
   * memberId портала Bitrix24 из cookie текущего запроса (или `null`) —
   * caller (route handler / RSC-клиент) читает cookie сам, чтобы этот пакет
   * не зависел от `next/headers`. См. `getBitrixApi()` на контексте.
   */
  memberId: string | null;
}

export function createORPCContext(opts: CreateORPCContextOptions) {
  let bitrixApiPromise: Promise<BitrixApi | null> | undefined;

  return {
    session: opts.session,
    headers: opts.headers,
    db,
    /** memberId портала Bitrix24 (для payload фоновых заданий trigger.dev). */
    memberId: opts.memberId,
    /** Резолвит Bitrix24-клиент для запроса лениво и не более одного раза. */
    getBitrixApi(): Promise<BitrixApi | null> {
      bitrixApiPromise ??= resolveBitrixApiForRequest(opts.memberId);
      return bitrixApiPromise;
    },
  };
}

/**
 * 2. INITIALIZATION
 *
 * This is where the oRPC api is initialized, connecting the context
 */
const o = os.$context<ReturnType<typeof createORPCContext>>();

/**
 * Timing middleware
 *
 * Emits a structured log line per request instead of a raw `console.log`.
 */
const timingMiddleware = o.middleware(async ({ next, path }) => {
  const start = Date.now();
  const pathStr = Array.isArray(path) ? path.join(".") : path;

  try {
    return await next();
  } catch (err) {
    logger.error(`orpc.error: ${pathStr}`, err, {
      path: pathStr,
      durationMs: Date.now() - start,
    });
    throw err;
  } finally {
    logger.info("orpc.request", {
      path: pathStr,
      durationMs: Date.now() - start,
    });
  }
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your oRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = o.use(timingMiddleware);
export const router = o.router.bind(o);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `context.session.user` is not null.
 *
 * @see https://orpc.dev/docs/server/procedures
 */
export const protectedProcedure = publicProcedure.use(({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({
    context: {
      ...context,
      session: context.session as {
        user: { id: string; email: string; name: string };
      },
    },
  });
});

/**
 * Admin (privileged) procedure
 *
 * Builds on `protectedProcedure` and additionally verifies that the
 * authenticated user has admin privileges.
 *
 * Admin access is granted to emails listed in the ADMIN_EMAILS environment
 * variable (comma-separated).
 *
 * @example ADMIN_EMAILS=admin@example.com,ops@example.com
 */
export const adminProcedure = protectedProcedure.use(({ context, next }) => {
  const adminEmails = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!adminEmails.includes(context.session.user.email.toLowerCase())) {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }

  return next();
});

// Export the context type for use in other files
export type ORPCContext = ReturnType<typeof createORPCContext>;
