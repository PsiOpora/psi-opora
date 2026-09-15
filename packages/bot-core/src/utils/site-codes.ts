export interface SiteCodeEntry {
	/** Сайт-источник трафика → уходит в Bitrix UTM_SOURCE */
	source: string;
	/** Конкретное размещение на сайте → уходит в Bitrix UTM_CAMPAIGN */
	campaign?: string;
}

/**
 * Коды для ссылок вида t.me/<bot>?start=<code> (и аналогичных для MAX).
 * Один код = одно размещение на одном сайте. Добавляя новый код сюда,
 * сразу получаем его в отчётах Bitrix по UTM_SOURCE/UTM_CAMPAIGN.
 */
export const SITE_CODES: Record<string, SiteCodeEntry> = {
	psi_opora_main: { source: "psi-opora.ru", campaign: "main_banner" },
	psi_opora_footer: { source: "psi-opora.ru", campaign: "footer" },
	search_anorexia_708811857: {
		source: "yandex",
		campaign: "search_anorexia_708811857",
	},
	rsya_retarget_anorexia_710733080: {
		source: "yandex",
		campaign: "rsya_retarget_anorexia_710733080",
	},
	"РК- ОКР по конверсиям": {
		source: "yandex",
		campaign: "РК- ОКР по конверсиям",
	},
};
