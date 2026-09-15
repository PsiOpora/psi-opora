"use client";

import { Suspense, type ReactNode } from "react";

/**
 * useSearchParams()/useParams() в клиентских страницах требуют границы
 * Suspense при `next build` (иначе сборка падает с "should be wrapped in
 * a suspense boundary"). Оборачиваем содержимое страницы здесь вместо
 * дублирования Suspense в каждом page.tsx.
 */
export function PageSuspense({ children }: { children: ReactNode }) {
	return (
		<Suspense
			fallback={<p className="text-sm text-muted-foreground">Загрузка…</p>}
		>
			{children}
		</Suspense>
	);
}
