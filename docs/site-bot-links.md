# Ссылки сайта на бота: метка кампании + ClientID Метрики

Скрипт для сайта psi-opora.ru (WordPress, вне этого репозитория). Он
дописывает к ссылкам на Telegram/MAX-бота параметр `start`: метку рекламной
кампании и ClientID Яндекс.Метрики (`_ym…`), по которому бот связывает сделку
с визитами на сайте (`packages/bot-core/src/utils/utm.ts`, `extractYmClientId`).

## Что было не так (аудит 24.10.2026)

Текущий скрипт берёт метку только из атрибута `data-lead-code`, а у кнопок
`.js-lead-btn` его нет. Поэтому бот получал `start=_ym<ClientID>_yc<yclid>`
без кампании — в Bitrix такие сделки приходили как «max бот» без рекламы.
Если же метку дописать как есть, `start` у кликов из Директа превышает
64 символа (предел Telegram: только `A-Za-z0-9_-`, до 64), и Telegram
открывает бота вообще без параметра.

## Что делает новый скрипт

- Метка — `data-lead-code` кнопки, иначе `utm_campaign` страницы входа (если
  она из допустимых символов). Метка и `yclid` запоминаются в `sessionStorage`
  на первой странице визита, поэтому не теряются при переходе по сайту.
- Длина `start` не больше 64. При нехватке места сначала убирается `yclid`
  (при ClientID он не нужен), затем метка; ClientID сохраняется всегда.
- Остальное как раньше: ждёт ClientID до 1,2 с, открывает ссылку в новой
  вкладке, если у кнопки `target="_blank"`.

Метки, которые бот знает (`packages/bot-core/src/utils/site-codes.ts`):
`search_anorexia_708811857`, `rsya_retarget_anorexia_710733080`,
`rsya_retarget_anorexia_v2`, `direct_okr`. Незнакомая метка тоже не
теряется — бот запишет её как кампанию, а фоновая задача Метрики дополнит
сделку по ClientID.

## Как поставить

1. Найти текущий скрипт: он начинается с `var COUNTER_ID=89679296;var
   SELECTOR='a.msg-tg, a.msg-max, …` (подключён в теме или через плагин
   вставки кода; на странице он попадает в минифицированный файл WP Rocket).
2. Заменить его целиком на код ниже.
3. Очистить кэш WP Rocket.
4. Проверить: открыть `https://psi-opora.ru/services/rpp/anorexia/?utm_campaign=search_anorexia_708811857&yclid=1234567890123456789`,
   нажать кнопку Telegram — адрес должен быть вида
   `https://t.me/KLUVAND_BOT?start=search_anorexia_708811857_ym…` (не длиннее
   64 символов после `start=`), для MAX — с тем же параметром.

```js
(function () {
	"use strict";
	var COUNTER_ID = 89679296;
	var SELECTOR =
		'a.msg-tg, a.msg-max, a[href^="https://t.me/"], a[href^="https://max.ru/"]';
	var CLIENT_ID_WAIT_MS = 1200;
	var CLIENT_ID_POLL_MS = 100;
	// Telegram: start — только A-Za-z0-9_- и не длиннее 64 символов.
	var MAX_START_LENGTH = 64;
	var SAFE_RE = /^[A-Za-z0-9_-]+$/;
	var STORAGE_PREFIX = "psi_lead_";

	function readParam(name) {
		try {
			return new URLSearchParams(window.location.search).get(name) || "";
		} catch (e) {
			return "";
		}
	}

	// Значение из адреса страницы, иначе запомненное на первой странице визита.
	function remembered(name, validate) {
		var value = readParam(name);
		try {
			if (value && validate(value)) {
				window.sessionStorage.setItem(STORAGE_PREFIX + name, value);
				return value;
			}
			return window.sessionStorage.getItem(STORAGE_PREFIX + name) || "";
		} catch (e) {
			return value && validate(value) ? value : "";
		}
	}

	function isSafe(value) {
		return SAFE_RE.test(value) && value.length <= MAX_START_LENGTH;
	}

	function isYclid(value) {
		return /^\d{10,25}$/.test(value);
	}

	// Запоминаем метки сразу при заходе, а не только при клике.
	remembered("utm_campaign", isSafe);
	remembered("yclid", isYclid);

	function waitForYm(timeoutMs) {
		return new Promise(function (resolve) {
			var waited = 0;
			(function poll() {
				if (typeof window.ym === "function") {
					resolve(true);
					return;
				}
				waited += CLIENT_ID_POLL_MS;
				if (waited >= timeoutMs) {
					resolve(false);
					return;
				}
				setTimeout(poll, CLIENT_ID_POLL_MS);
			})();
		});
	}

	function getClientId(timeoutMs) {
		return new Promise(function (resolve) {
			var timer = setTimeout(function () {
				resolve(null);
			}, timeoutMs);
			waitForYm(timeoutMs).then(function (ready) {
				if (!ready) {
					clearTimeout(timer);
					resolve(null);
					return;
				}
				try {
					window.ym(COUNTER_ID, "getClientID", function (clientId) {
						clearTimeout(timer);
						resolve(clientId ? String(clientId) : null);
					});
				} catch (e) {
					clearTimeout(timer);
					resolve(null);
				}
			});
		});
	}

	function buildStartParam(link, clientId) {
		var leadCode = link.getAttribute("data-lead-code") || "";
		var code = isSafe(leadCode)
			? leadCode
			: remembered("utm_campaign", isSafe);
		var ym = clientId && /^\d{10,25}$/.test(clientId) ? "_ym" + clientId : "";
		var yclid = remembered("yclid", isYclid);
		var yc = yclid ? "_yc" + yclid : "";

		// Приоритет: ClientID > метка кампании > yclid.
		if ((code + ym + yc).length > MAX_START_LENGTH) yc = ym ? "" : yc;
		if ((code + ym + yc).length > MAX_START_LENGTH) code = "";
		if ((code + ym + yc).length > MAX_START_LENGTH) yc = "";
		return code + ym + yc;
	}

	function openLink(url, newTab) {
		if (newTab) {
			window.open(url, "_blank", "noopener");
		} else {
			window.location.href = url;
		}
	}

	document.addEventListener(
		"click",
		function (event) {
			var link = event.target.closest ? event.target.closest(SELECTOR) : null;
			if (!link) return;
			event.preventDefault();
			var newTab = link.target === "_blank";
			var baseUrl = link.href;
			getClientId(CLIENT_ID_WAIT_MS).then(function (clientId) {
				var startParam = buildStartParam(link, clientId);
				var finalUrl = startParam
					? baseUrl +
						(baseUrl.indexOf("?") === -1 ? "?" : "&") +
						"start=" +
						encodeURIComponent(startParam)
					: baseUrl;
				openLink(finalUrl, newTab);
			});
		},
		true,
	);
})();
```
