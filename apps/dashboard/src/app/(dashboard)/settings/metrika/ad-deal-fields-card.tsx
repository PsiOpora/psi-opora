"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@psi-opora/api";
import {
	type YandexAdDealFieldsInput,
	yandexAdDealFieldsSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc/client";

type YandexMetrikaSettings = RouterOutputs["yandexMetrika"]["getSettings"];

const FIELDS: Array<{
	name: keyof YandexAdDealFieldsInput;
	label: string;
	hint?: string;
}> = [
	{ name: "campaign", label: "Кампания" },
	{ name: "adGroup", label: "Группа объявлений" },
	{ name: "ad", label: "Объявление" },
	{
		name: "searchQuery",
		label: "Поисковый запрос",
		hint: "Дописывается на следующий день из отчёта Директа по поисковым запросам",
	},
	{ name: "region", label: "Регион" },
	{
		name: "clickPosition",
		label: "Позиция клика",
		hint: "Место объявления в блоке выдачи, например «1 · премиум-показы»",
	},
	{ name: "landingPage", label: "Страница перехода" },
];

function toFormValues(
	settings: YandexMetrikaSettings | undefined,
): YandexAdDealFieldsInput {
	const codes = settings?.bitrixAdDealFields ?? {};
	return Object.fromEntries(
		FIELDS.map(({ name }) => [name, codes[name] ?? ""]),
	) as YandexAdDealFieldsInput;
}

/** Коды пользовательских полей сделки Bitrix, куда бот пишет данные рекламы. */
export function YandexAdDealFieldsCard({
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

	const form = useForm<YandexAdDealFieldsInput>({
		resolver: zodResolver(yandexAdDealFieldsSchema),
		defaultValues: toFormValues(initialSettings),
	});

	const mutation = useMutation(
		orpc.yandexMetrika.upsertAdDealFields.mutationOptions({
			onSuccess: () => {
				toast.success("Поля сделки сохранены");
				form.reset(form.getValues());
				queryClient.invalidateQueries({
					queryKey: orpc.yandexMetrika.getSettings.key(),
				});
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось сохранить поля сделки");
			},
		}),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Данные рекламы в сделке</CardTitle>
				<CardDescription>
					Создайте в Bitrix строковые поля сделки (CRM → Настройки →
					Пользовательские поля → Сделка) и укажите их коды. Значения берутся из
					последнего касания с рекламой. Незаполненные поля бот не пишет, а всё
					перечисленное в любом случае остаётся в «Источник: дополнительно» и в
					таймлайне сделки.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
						className="flex flex-col gap-4"
					>
						<div className="grid grid-cols-2 gap-4">
							{FIELDS.map(({ name, label, hint }) => (
								<FormField
									key={name}
									control={form.control}
									name={name}
									render={({ field }) => (
										<FormItem>
											<FormLabel className="text-xs text-muted-foreground">
												{label}
											</FormLabel>
											<FormControl>
												<Input
													placeholder="UF_CRM_1234567890"
													className="font-mono text-sm"
													{...field}
												/>
											</FormControl>
											{hint && (
												<FormDescription className="text-xs">
													{hint}
												</FormDescription>
											)}
											<FormMessage />
										</FormItem>
									)}
								/>
							))}
						</div>

						{settings?.updatedAt && (
							<p className="text-xs text-muted-foreground">
								Сохранено:{" "}
								{new Date(settings.updatedAt).toLocaleString("ru-RU")}
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
			</CardContent>
		</Card>
	);
}
