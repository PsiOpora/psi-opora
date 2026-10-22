"use client";

import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

const MAX_QUERY_RETRIES = 3;

function isUnauthorized(error: unknown): boolean {
	return error instanceof ORPCError && error.code === "UNAUTHORIZED";
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
	// QueryClient создаётся в состоянии, а не на уровне модуля, чтобы при
	// SSR каждый запрос получал свой экземпляр и кэш не тёк между пользователями.
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 30_000,
						refetchOnWindowFocus: false,
						// 401 уже пережил продление сессии в oRPC-линке — повтор не
						// поможет, только забьёт лог ошибками до следующего поллинга.
						retry: (failureCount, error) =>
							!isUnauthorized(error) && failureCount < MAX_QUERY_RETRIES,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
