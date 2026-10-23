import type { ScenarioTexts } from "@psi-opora/bot-core";

/**
 * Страница мини-приложения MAX — открывается кнопкой «Открыть» в чате с
 * ботом (URL задаётся в business.max.ru, см. docs/max-mini-app.md). Тексты
 * берутся из bot_texts (группа «Мини-приложение MAX» в дашборде), всё
 * остальное — статичная разметка без сборки: страница одна и маленькая.
 */

export interface WebAppPageOptions {
	texts: ScenarioTexts;
	/** Username бота без «@»; null — не удалось узнать, ссылки на чат нет. */
	botUsername: string | null;
}

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

// Ссылка, email или телефон внутри строки контактов. Хвостовую пунктуацию
// у ссылки отрезаем: «Сайт: https://psi-opora.ru.» — точка не часть адреса.
const CONTACT_TOKEN_RE =
	/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(\+?\d[\d\s()-]{8,}\d)/g;

/** Строка контактов → HTML с кликабельными ссылками, email и телефонами. */
export function linkifyContactLine(line: string): string {
	let html = "";
	let last = 0;
	for (const match of line.matchAll(CONTACT_TOKEN_RE)) {
		const [token, url, email, phone] = match;
		const index = match.index ?? 0;
		html += escapeHtml(line.slice(last, index));
		if (url) {
			html += `<a href="${escapeHtml(url)}" data-external>${escapeHtml(url.replace(/^https?:\/\//, ""))}</a>`;
		} else if (email) {
			html += `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`;
		} else if (phone) {
			const digits = phone.replace(/[^\d+]/g, "");
			html += `<a href="tel:${escapeHtml(digits)}">${escapeHtml(phone)}</a>`;
		} else {
			html += escapeHtml(token);
		}
		last = index + token.length;
	}
	return html + escapeHtml(line.slice(last));
}

function renderContacts(contacts: string): string {
	const lines = contacts
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (!lines.length) return "";
	const items = lines
		.map((line) => `<li>${linkifyContactLine(line)}</li>`)
		.join("");
	return `<section class="card contacts"><h2>Контакты</h2><ul>${items}</ul></section>`;
}

/** JSON для вставки в <script>: `<` экранируем, чтобы текст не закрыл тег. */
function inlineJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderWebAppPage({
	texts,
	botUsername,
}: WebAppPageOptions): string {
	const config = {
		botUsername,
		greeting: texts.webapp_greeting,
	};
	return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(texts.webapp_title)}</title>
<script src="https://st.max.ru/js/max-web-app.js"></script>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f4f5f7;
    --card: #ffffff;
    --text: #1d1f23;
    --muted: #61656d;
    --accent: #2f6fde;
    --accent-text: #ffffff;
    --border: #e3e5e9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141518;
      --card: #1f2125;
      --text: #eceef1;
      --muted: #a1a5ad;
      --accent: #5b8ff0;
      --border: #2d3036;
    }
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    min-height: 100%;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
  }
  h1 { margin: 0 0 4px; font-size: 22px; line-height: 1.3; }
  h2 { margin: 0 0 8px; font-size: 17px; }
  .greeting { margin: 0 0 8px; font-weight: 600; }
  .intro { margin: 0; color: var(--muted); white-space: pre-line; }
  .actions { display: flex; flex-direction: column; gap: 10px; }
  button {
    width: 100%;
    border: 0;
    border-radius: 12px;
    padding: 14px 16px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button.primary { background: var(--accent); color: var(--accent-text); }
  button.secondary {
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--border);
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .status { margin: 0; min-height: 1.5em; color: var(--muted); font-size: 14px; text-align: center; }
  .status.error { color: #d33c3c; }
  .contacts ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .contacts a { color: var(--accent); text-decoration: none; word-break: break-word; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <section class="card">
    <h1>${escapeHtml(texts.webapp_title)}</h1>
    <p class="greeting" id="greeting" hidden></p>
    <p class="intro">${escapeHtml(texts.webapp_intro)}</p>
  </section>
  <section class="actions">
    <button class="primary" id="consult" type="button">${escapeHtml(texts.webapp_btn_consult)}</button>
    <button class="secondary" id="chat" type="button"${botUsername ? "" : " hidden"}>${escapeHtml(texts.webapp_btn_chat)}</button>
    <p class="status" id="status" role="status"></p>
  </section>
  ${renderContacts(texts.webapp_contacts)}
</main>
<script>
(function () {
  var config = ${inlineJson(config)};
  var app = window.WebApp;
  // WebApp есть и в обычном браузере (скрипт MAX грузится везде), а
  // подписанные initData — только внутри MAX.
  var inMax = !!(app && app.initData);
  var unsafe = (inMax && app.initDataUnsafe) || {};
  var startParam = typeof unsafe.start_param === "string" ? unsafe.start_param : "";
  var status = document.getElementById("status");
  var consultButton = document.getElementById("consult");
  var chatButton = document.getElementById("chat");

  var firstName = unsafe.user && unsafe.user.first_name;
  var greeting = String(config.greeting || "");
  greeting = firstName
    ? greeting.split("{name}").join(firstName)
    : greeting.replace(/,?\\s*\\{name\\}/g, "");
  if (greeting.trim()) {
    var greetingEl = document.getElementById("greeting");
    greetingEl.textContent = greeting;
    greetingEl.hidden = false;
  }

  function chatUrl(payload) {
    if (!config.botUsername) return null;
    var url = "https://max.ru/" + config.botUsername;
    return payload ? url + "?start=" + encodeURIComponent(payload) : url;
  }

  function setStatus(text, isError) {
    status.textContent = text;
    status.className = isError ? "status error" : "status";
  }

  // Назад в чат: внутри MAX — закрываем мини-приложение (чат под ним),
  // в обычном браузере — открываем диалог с ботом по ссылке.
  function backToChat(payload) {
    if (inMax && typeof app.close === "function") {
      app.close();
      return;
    }
    var url = chatUrl(payload);
    if (!url) return;
    if (inMax && typeof app.openMaxLink === "function") app.openMaxLink(url);
    else window.location.href = url;
  }

  if (inMax) chatButton.hidden = false;
  chatButton.addEventListener("click", function () {
    backToChat(/^[A-Za-z0-9_-]{1,64}$/.test(startParam) ? startParam : "");
  });

  consultButton.addEventListener("click", function () {
    // Открыто не из MAX (нет подписанных initData) — обычный диплинк.
    if (!inMax) {
      var url = chatUrl("CONSULT");
      if (url) window.location.href = url;
      else setStatus("Откройте эту страницу из чата с ботом в MAX.", true);
      return;
    }
    consultButton.disabled = true;
    setStatus("Секунду…", false);
    fetch("/webapp/consult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: app.initData }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        setStatus("Продолжим в чате с ботом 👇", false);
        setTimeout(function () { backToChat(""); }, 600);
      })
      .catch(function () {
        consultButton.disabled = false;
        setStatus("Не получилось начать запись. Попробуйте ещё раз или напишите боту в чат.", true);
      });
  });

  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[data-external]");
    if (!link || !inMax || typeof app.openLink !== "function") return;
    event.preventDefault();
    app.openLink(link.href);
  });

  if (inMax && typeof app.ready === "function") app.ready();
})();
</script>
</body>
</html>`;
}
