"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@psi-opora/api";
import {
	type YandexMetrikaSettingsInput,
	yandexMetrikaSettingsSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { blankToUndefined } from "@/lib/blank-to-undefined";
import { orpc } from "@/lib/orpc/client";

type YandexMetrikaSettings = RouterOutputs["yandexMetrika"]["getSettings"];

function toFormValues(
	settings: YandexMetrikaSettings,
): YandexMetrikaSettingsInput {
	return {
		counterId: settings?.counterId ?? "",
		oauthToken: settings?.oauthToken ?? "",
		goalId: settings?.goalId ?? "consultation_booked",
		bitrixClientIdField: settings?.bitrixClientIdField ?? "",
	};
}

export function YandexMetrikaSettingsForm({
	initialSettings,
}: {
	initialSettings: YandexMetrikaSettings;
}) {
	const queryClient = useQueryClient();

	const { data: settings } = useQuery(
		orpc.yandexMetrika.getSettings.queryOptions({
			initialData: initialSettings,
		}),
	);

	const form = useForm<YandexMetrikaSettingsInput>({
		resolver: zodResolver(yandexMetrikaSettingsSchema),
		defaultValues: toFormValues(initialSettings),
	});

	const mutation = useMutation(
		orpc.yandexMetrika.upsertSettings.mutationOptions({
			onSuccess: () => {
				toast.success("Настройки Яндекс.Метрики сохранены");
				// Сбрасывает флаг "изменено" формы, оставляя введённые значения как есть
				// (не значения с undefined, отправленные на сервер вместо пустых полей).
				form.reset(form.getValues());
				queryClient.invalidateQueries({
					queryKey: orpc.yandexMetrika.getSettings.key(),
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
						name="counterId"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs text-muted-foreground">
									Номер счётчика
								</FormLabel>
								<FormControl>
									<Input
										placeholder="12345678"
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
						name="goalId"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs text-muted-foreground">
									Идентификатор цели
								</FormLabel>
								<FormControl>
									<Input
										placeholder="consultation_booked"
										className="font-mono text-sm"
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>

				<FormField
					control={form.control}
					name="oauthToken"
					render={({ field }) => (
						<FormItem>
							<FormLabel className="text-xs text-muted-foreground">
								OAuth-токен
							</FormLabel>
							<FormControl>
								<Input
									type="password"
									placeholder="••••••••"
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
					name="bitrixClientIdField"
					render={({ field }) => (
						<FormItem>
							<FormLabel className="text-xs text-muted-foreground">
								Поле ClientID в сделке Bitrix (необязательно)
							</FormLabel>
							<FormControl>
								<Input
									placeholder="UF_CRM_1234567890"
									className="font-mono text-sm"
									{...field}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				{settings?.updatedAt && (
					<p className="text-xs text-muted-foreground">
						Сохранено: {new Date(settings.updatedAt).toLocaleString("ru-RU")}
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
