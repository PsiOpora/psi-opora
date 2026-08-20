export interface UtmTagInfo {
	tag: string;
	title: string;
	description: string;
	example: string;
}

/**
 * Значения приходят из полей сделки UTM_SOURCE/UTM_MEDIUM/... в Битрикс24 —
 * они заполняются автоматически, если клиент перешёл по ссылке с utm-метками.
 * "(не указано)" — сделка без меток (прямой заход, звонок и т.п.), см. NOT_SPECIFIED в deals.ts.
 */
export const UTM_TAGS: UtmTagInfo[] = [
	{
		tag: "utm_source",
		title: "Источник",
		description:
			"Откуда пришёл переход — рекламная площадка, поисковик или сайт-партнёр.",
		example: "google, yandex, vk, facebook, newsletter",
	},
	{
		tag: "utm_medium",
		title: "Канал / тип трафика",
		description:
			"Каким способом пришёл переход: тип рекламы или канала, а не конкретная площадка.",
		example: "cpc (платный поиск), cpm (баннер), email, social, referral",
	},
	{
		tag: "utm_campaign",
		title: "Кампания",
		description:
			"Название конкретной рекламной кампании — по нему сравнивают эффективность кампаний между собой.",
		example: "summer_sale_2026, avito_leadgen, launch_promo",
	},
	{
		tag: "utm_content",
		title: "Объявление / креатив",
		description:
			"Отличает конкретное объявление, баннер или кнопку внутри одной кампании — обычно используется в A/B-тестах креативов.",
		example: "banner_blue, cta_top, video_15s",
	},
	{
		tag: "utm_term",
		title: "Ключевое слово",
		description:
			"Поисковый запрос или ключевая фраза, по которой показывалась платная реклама.",
		example: "купить окна пластиковые, ремонт квартир",
	},
];

export function utmHint(tag: string): string {
	const info = UTM_TAGS.find((t) => t.tag === tag);
	if (!info) return "";
	return `${info.description} Примеры значений: ${info.example}.`;
}
