"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BotConnectorWidgetClient } from "./bot-connector-widget-client";

/**
 * Слайдер настроек коннектора официального бота, открываемый Bitrix24 из
 * Контакт-центра при подключении канала на линии (placement SETTING_CONNECTOR
 * через /api/bitrix/bot-connector-widget/[messenger]). В отличие от личного
 * номера — вводить нечего, окно само активирует линию и настраивает вебхук.
 */
export default function BotConnectorWidgetPage() {
	return (
		<Suspense fallback={null}>
			<BotConnectorWidgetPageContent />
		</Suspense>
	);
}

function BotConnectorWidgetPageContent() {
	const searchParams = useSearchParams();
	const messenger =
		searchParams.get("messenger") === "max" ? "max" : "telegram";
	const lineId = searchParams.get("line") ?? "";

	return (
		<div className="p-2">
			<BotConnectorWidgetClient messenger={messenger} lineId={lineId} />
		</div>
	);
}
