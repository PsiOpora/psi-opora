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
import { AdCampaignIdOverridesCard } from "./campaign-id-overrides";
import { AdCredentialsForm } from "./credentials-form";

export default function AdSettingsPage() {
	const { data: creds, isLoading } = useQuery(
		orpc.ads.getCredentials.queryOptions(),
	);

	return (
		<div className="flex flex-col gap-6 max-w-3xl">
			<div>
				<h1 className="text-2xl font-semibold">Настройки рекламы</h1>
				<p className="text-sm text-muted-foreground mt-1">
					Введите ключи из рекламных кабинетов.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Яндекс Директ</CardTitle>
					<CardDescription>
						Создайте приложение в{" "}
						<a
							href="https://oauth.yandex.ru/"
							target="_blank"
							rel="noreferrer"
							className="underline underline-offset-2"
						>
							Яндекс OAuth
						</a>{" "}
						и получите refresh_token через ручной OAuth-флоу.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-sm text-muted-foreground">Загрузка…</p>
					) : (
						<AdCredentialsForm initialCredentials={creds ?? null} />
					)}
				</CardContent>
			</Card>

			<AdCampaignIdOverridesCard />
		</div>
	);
}
