export interface CampaignLink {
	label: string;
	url: string;
}

export interface CampaignLinkGroup {
	/** null — общая ссылка без площадки. */
	source: string | null;
	links: CampaignLink[];
}

/**
 * Ссылки кампании на ботов: общая без площадки (`?start=FREE`) и по одной на
 * каждую площадку (`?start=FREE_vk`). Формат MAX повторяет телеграмный.
 */
export function buildCampaignLinks(
	code: string,
	sources: string[],
	usernames: { telegram: string; max: string },
): CampaignLinkGroup[] {
	const variants: Array<{ source: string | null; param: string }> = [
		{ source: null, param: code },
		...sources.map((source) => ({ source, param: `${code}_${source}` })),
	];

	return variants.map(({ source, param }) => {
		const links: CampaignLink[] = [];
		if (usernames.telegram) {
			links.push({
				label: "Telegram",
				url: `https://t.me/${usernames.telegram}?start=${param}`,
			});
		}
		if (usernames.max) {
			links.push({
				label: "MAX",
				url: `https://max.ru/${usernames.max}?start=${param}`,
			});
		}
		return { source, links };
	});
}
