/**
 * Разовое создание кастомного поля сделки UF_CRM_PAGE_URL — страница сайта,
 * с которой пришла заявка. Само поле сайт пока не заполняет (правки на
 * стороне сайта — вне этого репозитория), это только создание поля в Bitrix,
 * чтобы у сайта был готовый код для записи и дашборд мог его прочитать.
 * Идемпотентно: если поле с таким FIELD_NAME уже существует — ничего не делает.
 *
 * Запуск:
 *   bun --env-file=.env run scripts/create-deal-page-url-field.ts
 */
const FIELD_NAME = "PAGE_URL";
const FULL_FIELD_NAME = `UF_CRM_${FIELD_NAME}`;

interface BitrixResponse<T> {
	result?: T;
	error?: string;
	error_description?: string;
}

function webhookBase(): string {
	const value = process.env.TG_BITRIX_WEBHOOK_URL ?? process.env.BITRIX_WEBHOOK_URL;
	if (!value) throw new Error("BITRIX_WEBHOOK_URL не задан");
	return value.replace(/\/+$/, "");
}

async function callBitrix<T>(method: string, body: unknown): Promise<T> {
	const response = await fetch(`${webhookBase()}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await response.json()) as BitrixResponse<T>;
	if (json.error) {
		throw new Error(
			`Bitrix24 [${method}]: ${json.error} — ${json.error_description ?? ""}`,
		);
	}
	return json.result as T;
}

async function main() {
	const existing = await callBitrix<Array<{ ID: string; FIELD_NAME: string }>>(
		"crm.deal.userfield.list",
		{ filter: { FIELD_NAME } },
	);
	if (existing.length > 0) {
		console.log(
			`Поле ${FULL_FIELD_NAME} уже существует (ID=${existing[0]?.ID}), пропускаю создание.`,
		);
		return;
	}

	const id = await callBitrix<number>("crm.deal.userfield.add", {
		fields: {
			FIELD_NAME,
			USER_TYPE_ID: "string",
			LABEL: "Страница сайта (заявка)",
			LIST_COLUMN_LABEL: "Страница сайта",
			EDIT_FORM_LABEL: "Страница сайта (заявка)",
			HELP_MESSAGE: "Адрес страницы, с которой отправлена заявка",
			MANDATORY: "N",
			MULTIPLE: "N",
			SHOW_FILTER: "N",
			SHOW_IN_LIST: "Y",
			EDIT_IN_LIST: "Y",
		},
	});
	console.log(`Создано поле ${FULL_FIELD_NAME}, ID=${id}`);
}

await main();
