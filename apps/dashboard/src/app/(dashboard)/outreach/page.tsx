"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { orpc } from "@/lib/orpc/client";
import { OutreachHistory } from "./history";
import { OutreachForm } from "./outreach-form";

export default function OutreachPage() {
	return (
		<PageSuspense>
			<OutreachPageContent />
		</PageSuspense>
	);
}

function OutreachPageContent() {
	const searchParams = useSearchParams();
	const initialListId = searchParams.get("listId") ?? undefined;
	const lists = useQuery(orpc.emailLists.list.queryOptions());
	const templates = useQuery(orpc.emailTemplates.list.queryOptions());
	const options = useQuery(orpc.outreach.options.queryOptions());

	const loading = lists.isLoading || templates.isLoading || options.isLoading;
	const error = lists.error ?? templates.error ?? options.error;

	return (
		<div className="flex w-full flex-col gap-6">
			<div>
				<h1 className="text-2xl font-semibold">Рассылка по списку</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Сообщение контактам из{" "}
					<Link href="/email-lists" className="underline underline-offset-2">
						списка
					</Link>{" "}
					с личных номеров MAX, Telegram и WhatsApp, а кому не удалось написать
					в мессенджер — письмом. По каждому контакту сохраняется, что и через
					какой канал ушло.
				</p>
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground">Загрузка…</p>
			) : error || !options.data ? (
				<p className="text-sm text-destructive">
					Не удалось загрузить данные: {error?.message ?? "нет ответа"}.
					Обновите страницу.
				</p>
			) : (
				<OutreachForm
					lists={lists.data ?? []}
					templates={templates.data ?? []}
					options={options.data}
					initialListId={initialListId}
				/>
			)}

			<OutreachHistory />
		</div>
	);
}
