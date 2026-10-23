"use client";

import type { RouterOutputs } from "@psi-opora/api";
import {
	yandexAdDealFieldsSchema,
	yandexVisitDealFieldsSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc } from "@/lib/orpc/client";
import {
	DealFieldCodesCard,
	type DealFieldOption,
} from "./deal-field-codes-card";

type YandexMetrikaSettings = RouterOutputs["yandexMetrika"]["getSettings"];

const AD_FIELDS: DealFieldOption[] = [
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

const VISIT_FIELDS: DealFieldOption[] = [
	{ name: "visitCount", label: "Визитов до заявки" },
	{ name: "firstVisitAt", label: "Первый визит", hint: "Дата, ДД.ММ.ГГГГ" },
	{ name: "firstSource", label: "Источник первого визита" },
	{ name: "city", label: "Город", hint: "По последнему визиту" },
	{
		name: "device",
		label: "Устройство",
		hint: "Например «смартфон · iOS · Safari»",
	},
	{ name: "pageViews", label: "Просмотрено страниц" },
	{ name: "timeOnSite", label: "Время на сайте" },
	{ name: "goals", label: "Достигнутые цели" },
];

function useSettings(initialSettings: YandexMetrikaSettings) {
	return useQuery(
		orpc.yandexMetrika.getSettings.queryOptions({
			initialData: initialSettings,
		}),
	).data;
}

function useInvalidateSettings() {
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			queryKey: orpc.yandexMetrika.getSettings.key(),
		});
}

const onError = (error: Error) =>
	toast.error(error.message || "Не удалось сохранить поля сделки");

/** Коды полей сделки, куда бот пишет данные рекламы последнего касания. */
export function YandexAdDealFieldsCard({
	initialSettings,
}: {
	initialSettings: YandexMetrikaSettings;
}) {
	const settings = useSettings(initialSettings);
	const invalidate = useInvalidateSettings();
	const mutation = useMutation(
		orpc.yandexMetrika.upsertAdDealFields.mutationOptions({
			onSuccess: () => {
				toast.success("Поля сделки сохранены");
				invalidate();
			},
			onError,
		}),
	);
	return (
		<DealFieldCodesCard
			title="Данные рекламы в сделке"
			description="Создайте в Bitrix строковые поля сделки (CRM → Настройки → Пользовательские поля → Сделка) и укажите их коды. Значения берутся из последнего касания с рекламой. Незаполненные поля бот не пишет, а всё перечисленное в любом случае остаётся в «Источник: дополнительно» и в таймлайне сделки."
			fields={AD_FIELDS}
			schema={yandexAdDealFieldsSchema}
			savedCodes={initialSettings?.bitrixAdDealFields}
			updatedAt={settings?.updatedAt}
			isPending={mutation.isPending}
			onSave={(codes) => mutation.mutateAsync(codes)}
		/>
	);
}

/** Коды полей сделки для сводки визитов на сайт из Logs API Метрики. */
export function YandexVisitDealFieldsCard({
	initialSettings,
}: {
	initialSettings: YandexMetrikaSettings;
}) {
	const settings = useSettings(initialSettings);
	const invalidate = useInvalidateSettings();
	const mutation = useMutation(
		orpc.yandexMetrika.upsertVisitDealFields.mutationOptions({
			onSuccess: () => {
				toast.success("Поля сделки сохранены");
				invalidate();
			},
			onError,
		}),
	);
	return (
		<DealFieldCodesCard
			title="Визиты на сайт в сделке"
			description="На следующий день после создания сделки крон выгружает из Logs API Метрики визиты клиента по ClientID за 30 дней до заявки и пишет сводку в эти поля, а список визитов — в таймлайн. OAuth-токену нужны права на чтение Метрики. Пол, возраст и поисковые фразы по одному посетителю Метрика не отдаёт."
			fields={VISIT_FIELDS}
			schema={yandexVisitDealFieldsSchema}
			savedCodes={initialSettings?.bitrixVisitDealFields}
			updatedAt={settings?.updatedAt}
			isPending={mutation.isPending}
			onSave={(codes) => mutation.mutateAsync(codes)}
		/>
	);
}
