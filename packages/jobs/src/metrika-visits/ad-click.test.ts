import { describe, expect, test } from "bun:test";
import {
	adDealFields,
	adUtmFields,
	describeAdClick,
	isNetworkClick,
	parseAdClick,
} from "./ad-click";
import type { LogsVisitRow } from "./logs-api";

function row(overrides: Partial<LogsVisitRow> = {}): LogsVisitRow {
	return {
		startURL:
			"https://psi-opora.ru/anorexia/?utm_source=yandex&utm_campaign=search_anorexia_708811857&phrase_id=1234567890&position=1&position_type=premium&region_name=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0",
		lastTrafficSource: "ad",
		lastAdvEngine: "ya_direct",
		lastDirectClickOrder: "708811857",
		lastDirectClickOrderName: "Анорексия — поиск",
		lastDirectBannerGroup: "5600000111",
		lastClickBannerGroupName: "Лечение анорексии",
		lastDirectClickBanner: "17000000123",
		lastDirectClickBannerName: "Помощь при анорексии",
		lastDirectPhraseOrCond: "лечение анорексии",
		lastDirectPlatformType: "search",
		lastUTMTerm: "",
		...overrides,
	};
}

describe("parseAdClick", () => {
	test("ID и названия — из полей Метрики, позиция и регион — из адреса входа", () => {
		expect(parseAdClick(row())).toEqual({
			campaignId: "708811857",
			campaignName: "Анорексия — поиск",
			groupId: "5600000111",
			groupName: "Лечение анорексии",
			adId: "17000000123",
			adName: "Помощь при анорексии",
			condition: "лечение анорексии",
			keywordId: "1234567890",
			platformType: "search",
			position: "1",
			positionType: "premium",
			regionName: "Москва",
			landingPage: "https://psi-opora.ru/anorexia/",
			utmCampaign: "search_anorexia_708811857",
		});
	});

	test("регион показа читается и из параметра region", () => {
		const click = parseAdClick(
			row({
				startURL: "https://psi-opora.ru/?region=%D0%A2%D0%B2%D0%B5%D1%80%D1%8C",
			}),
		);
		expect(click?.regionName).toBe("Тверь");
	});

	test("без полей Директа в Метрике ID берутся из параметров ссылки", () => {
		const click = parseAdClick(
			row({
				startURL:
					"https://psi-opora.ru/?utm_campaign=search_anorexia_708811857&gbid=5600000111&ad_id=17000000123",
				lastDirectClickOrder: "0",
				lastDirectBannerGroup: "0",
				lastDirectClickBanner: "",
				lastDirectClickOrderName: "",
				lastClickBannerGroupName: "",
				lastDirectClickBannerName: "",
			}),
		);
		expect(click).toMatchObject({
			campaignId: "708811857",
			groupId: "5600000111",
			adId: "17000000123",
		});
	});

	test("визит не с Директа — не рекламный клик", () => {
		expect(
			parseAdClick(
				row({
					lastTrafficSource: "organic",
					lastAdvEngine: "",
					lastDirectClickOrder: "0",
					lastDirectBannerGroup: "0",
					startURL: "https://psi-opora.ru/",
				}),
			),
		).toBeUndefined();
	});

	test("нераскрытые макросы в адресе не попадают в значения", () => {
		const click = parseAdClick(
			row({
				startURL:
					"https://psi-opora.ru/?position={position}&position_type={position_type}",
			}),
		);
		expect(click?.position).toBeUndefined();
		expect(click?.positionType).toBeUndefined();
	});
});

describe("поля сделки и описание", () => {
	test("город визита важнее региона показа, позиция читаемо", () => {
		const click = parseAdClick(row());
		expect(click && adDealFields(click, "Saint Petersburg")).toEqual({
			campaign: "Анорексия — поиск",
			adGroup: "Лечение анорексии",
			ad: "Помощь при анорексии (17000000123)",
			region: "Saint Petersburg",
			clickPosition: "1 · премиум-показы",
			landingPage: "https://psi-opora.ru/anorexia/",
		});
		expect(click && adDealFields(click, "")).toMatchObject({
			region: "Москва",
		});
	});

	test("описание клика для таймлайна", () => {
		const click = parseAdClick(row());
		expect(click && describeAdClick(click)).toBe(
			"РК «Анорексия — поиск» · группа «Лечение анорексии» · объявление «Помощь при анорексии (17000000123)» · условие «лечение анорексии» · позиция 1 · премиум-показы",
		);
	});

	test("UTM сделки: метки из ссылки, иначе ID кампании и объявления", () => {
		expect(
			adUtmFields({
				campaignId: "708811857",
				adId: "17000000123",
				condition: "лечение анорексии",
			}),
		).toEqual({
			UTM_SOURCE: "yandex",
			UTM_MEDIUM: "cpc",
			UTM_CAMPAIGN: "708811857",
			UTM_CONTENT: "17000000123",
			UTM_TERM: "лечение анорексии",
		});
		expect(adUtmFields({})).toEqual({
			UTM_SOURCE: "yandex",
			UTM_MEDIUM: "cpc",
		});
	});

	test("клик в сетях распознаётся по позиции и типу площадки", () => {
		expect(isNetworkClick({ position: "0" })).toBe(true);
		expect(isNetworkClick({ positionType: "none" })).toBe(true);
		expect(isNetworkClick({ platformType: "context" })).toBe(true);
		expect(isNetworkClick({ platformType: "search", position: "2" })).toBe(
			false,
		);
	});
});
