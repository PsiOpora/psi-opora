"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { orpc } from "@/lib/orpc/client";
import { YandexMetrikaSettingsForm } from "./credentials-form";

export default function YandexMetrikaSettingsPage() {
	const { data: settings, isLoading } = useQuery(
		orpc.yandexMetrika.getSettings.queryOptions(),
	);

	return (
		<div className="flex flex-col gap-6 max-w-2xl">
			<div>
				<h1 className="text-2xl font-semibold">Яндекс.Метрика</h1>
				<p className="text-sm text-muted-foreground mt-1">
					Автоматическая офлайн-конверсия «Запись на консультацию»: сразу после
					создания сделки в Bitrix бот отправляет в Метрику конверсию по
					ClientID визита — без ручного экспорта заявок и загрузки конверсий.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Счётчик и цель</CardTitle>
					<CardDescription>
						Номер счётчика — Метрика → счётчик сайта → номер в адресной строке.
						OAuth-токен получите в{" "}
						<a
							href="https://oauth.yandex.ru/"
							target="_blank"
							rel="noreferrer"
							className="underline underline-offset-2"
						>
							Яндекс OAuth
						</a>{" "}
						(права на Метрику). Цель — заранее созданная в счётчике цель типа
						«JavaScript-событие» с условием «содержит» и указанным ниже
						идентификатором.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-sm text-muted-foreground">Загрузка…</p>
					) : (
						<YandexMetrikaSettingsForm initialSettings={settings ?? null} />
					)}
				</CardContent>
			</Card>
		</div>
	);
}
