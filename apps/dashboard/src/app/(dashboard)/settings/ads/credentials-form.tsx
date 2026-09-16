"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@psi-opora/api";
import {
	type AdCredentialsInput,
	adCredentialsSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { blankToUndefined } from "@/lib/blank-to-undefined";
import { orpc } from "@/lib/orpc/client";

type AdCredentials = RouterOutputs["ads"]["getCredentials"];

function toFormValues(creds: AdCredentials): AdCredentialsInput {
	return {
		yandexClientId: creds?.yandexClientId ?? "",
		yandexClientSecret: creds?.yandexClientSecret ?? "",
		yandexRefreshToken: creds?.yandexRefreshToken ?? "",
		vkAccessToken: creds?.vkAccessToken ?? "",
		vkAdsAccountId: creds?.vkAdsAccountId ?? "",
	};
}

export function AdCredentialsForm({
	initialCredentials,
}: {
	initialCredentials: AdCredentials;
}) {
	const queryClient = useQueryClient();
	const [showClientSecret, setShowClientSecret] = useState(false);
	const [showRefreshToken, setShowRefreshToken] = useState(false);
	const [showVkToken, setShowVkToken] = useState(false);

	const { data: creds } = useQuery(
		orpc.ads.getCredentials.queryOptions({
			initialData: initialCredentials,
		}),
	);

	const form = useForm<AdCredentialsInput>({
		resolver: zodResolver(adCredentialsSchema),
		defaultValues: toFormValues(initialCredentials),
	});

	const mutation = useMutation(
		orpc.ads.upsertCredentials.mutationOptions({
			onSuccess: () => {
				toast.success("Настройки рекламы сохранены");
				// Сбрасывает флаг "изменено" формы, оставляя введённые значения как есть
				// (не значения с undefined, отправленные на сервер вместо пустых полей).
				form.reset(form.getValues());
				queryClient.invalidateQueries({
					queryKey: orpc.ads.getCredentials.key(),
				});
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось сохранить настройки");
			},
		}),
	);

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit((values) =>
					mutation.mutate(blankToUndefined(values)),
				)}
				className="flex flex-col gap-4"
			>
				<div className="grid grid-cols-2 gap-4">
					<FormField
						control={form.control}
						name="yandexClientId"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs text-muted-foreground">
									Client ID
								</FormLabel>
								<FormControl>
									<Input
										placeholder="abc123def456"
										className="font-mono text-sm"
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="yandexClientSecret"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs text-muted-foreground">
									Client Secret
								</FormLabel>
								<div className="relative">
									<FormControl>
										<Input
											type={showClientSecret ? "text" : "password"}
											placeholder="••••••••"
											className="font-mono text-sm pr-10"
											{...field}
										/>
									</FormControl>
									<button
										type="button"
										onClick={() => setShowClientSecret((prev) => !prev)}
										className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
										aria-label={
											showClientSecret
												? "Hide client secret"
												: "Show client secret"
										}
										aria-pressed={showClientSecret}
									>
										{showClientSecret ? (
											<EyeOff className="size-4" />
										) : (
											<Eye className="size-4" />
										)}
									</button>
									</div>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>

				<FormField
					control={form.control}
					name="yandexRefreshToken"
					render={({ field }) => (
						<FormItem>
							<FormLabel className="text-xs text-muted-foreground">
								Refresh Token
							</FormLabel>
							<div className="relative">
								<FormControl>
									<Input
										type={showRefreshToken ? "text" : "password"}
										placeholder="••••••••"
										className="font-mono text-sm pr-10"
										{...field}
									/>
								</FormControl>
								<button
									type="button"
									onClick={() => setShowRefreshToken((prev) => !prev)}
									className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
									aria-label={
										showRefreshToken
											? "Hide refresh token"
											: "Show refresh token"
									}
									aria-pressed={showRefreshToken}
								>
									{showRefreshToken ? (
										<EyeOff className="size-4" />
									) : (
										<Eye className="size-4" />
									)}
								</button>
								</div>
							<FormMessage />
						</FormItem>
					)}
				/>

				<div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
					<p className="font-medium text-foreground">
						Как получить Refresh Token для Яндекс.Директа
					</p>
					<ol className="mt-2 list-decimal space-y-1.5 pl-4">
						<li>
							Зайдите в{" "}
							<a
								href="https://oauth.yandex.ru/client/new"
								target="_blank"
								rel="noreferrer"
								className="underline underline-offset-2"
							>
								oauth.yandex.ru/client/new
							</a>{" "}
							и создайте приложение (или откройте уже существующее в{" "}
							<a
								href="https://oauth.yandex.ru/"
								target="_blank"
								rel="noreferrer"
								className="underline underline-offset-2"
							>
								списке приложений
							</a>
							).
						</li>
						<li>
							В разделе «Платформы» выберите «Веб-сервисы» и укажите Redirect
							URI{" "}
							<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
								https://oauth.yandex.ru/verification_code
							</code>{" "}
							(значение по умолчанию — подходит для ручного получения токена).
						</li>
						<li>
							В разделе «Доступ к данным» добавьте права Яндекс.Директа:{" "}
							<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
								direct:api
							</code>
							.
						</li>
						<li>
							Сохраните приложение и скопируйте его <b>ClientID</b> и{" "}
							<b>Client Secret</b> — вставьте их в поля выше.
						</li>
						<li>
							Откройте в браузере (под учёткой, у которой есть доступ к
							рекламным кабинетам Директа) ссылку вида:
							<br />
							<code className="mt-1 block break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">
								https://oauth.yandex.ru/authorize?response_type=code&client_id=ВАШ_CLIENT_ID
							</code>
						</li>
						<li>
							Разрешите доступ — Яндекс покажет одноразовый код подтверждения.
						</li>
						<li>
							Обменяйте код на токены запросом (например, curl или Postman):
							<br />
							<code className="mt-1 block break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">
								curl -X POST https://oauth.yandex.ru/token -d
								"grant_type=authorization_code&code=КОД&client_id=ВАШ_CLIENT_ID&client_secret=ВАШ_CLIENT_SECRET"
							</code>
						</li>
						<li>
							В ответе будет поле <code className="font-mono">refresh_token</code>{" "}
							— скопируйте его в поле выше и сохраните. Access-токен, который
							сервис получает по нему, живёт недолго и автоматически
							обновляется бэкендом при каждом запросе к Директу.
						</li>
					</ol>
					<p className="mt-2">
						Refresh token у Яндекса не бессрочный — если отчёты по рекламе
						перестанут обновляться с ошибкой{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
							invalid_grant
						</code>
						, повторите шаги 5–8.
					</p>
				</div>

				<Separator />

				<div className="flex flex-col gap-1">
					<h3 className="text-lg font-medium">VK Реклама</h3>
					<p className="text-sm text-muted-foreground">
						Получите токен в{" "}
						<a
							href="https://ads.vk.com/hq/settings"
							target="_blank"
							rel="noreferrer"
							className="underline underline-offset-2"
						>
							кабинете VK Реклама
						</a>{" "}
						(раздел Настройки → Доступ к API).
					</p>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<FormField
						control={form.control}
						name="vkAccessToken"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs text-muted-foreground">
									Access Token
								</FormLabel>
								<div className="relative">
									<FormControl>
										<Input
											type={showVkToken ? "text" : "password"}
											placeholder="••••••••"
											className="font-mono text-sm pr-10"
											{...field}
										/>
									</FormControl>
									<button
										type="button"
										onClick={() => setShowVkToken((prev) => !prev)}
										className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
										aria-label={
											showVkToken
												? "Hide VK access token"
												: "Show VK access token"
										}
										aria-pressed={showVkToken}
									>
										{showVkToken ? (
											<EyeOff className="size-4" />
										) : (
											<Eye className="size-4" />
										)}
									</button>
									</div>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="vkAdsAccountId"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs text-muted-foreground">
									Ads Account ID
								</FormLabel>
								<FormControl>
									<Input
										placeholder="123456789"
										className="font-mono text-sm"
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>

				{creds?.updatedAt && (
					<p className="text-xs text-muted-foreground">
						Сохранено: {new Date(creds.updatedAt).toLocaleString("ru-RU")}
					</p>
				)}

				<Button
					type="submit"
					disabled={mutation.isPending}
					className="self-start"
				>
					{mutation.isPending ? "Сохраняем…" : "Сохранить"}
				</Button>
			</form>
		</Form>
	);
}
