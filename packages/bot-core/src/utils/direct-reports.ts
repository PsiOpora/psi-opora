const REPORTS_URL = "https://api.direct.yandex.com/json/v5/reports";
const REPORT_MAX_ATTEMPTS = 6;
const REPORT_MAX_WAIT_SECONDS = 30;

export interface DirectReportFilter {
	Field: string;
	Operator: "EQUALS" | "IN" | "GREATER_THAN" | "LESS_THAN" | "NOT_EQUALS";
	Values: string[];
}

export interface DirectReportParams {
	token: string;
	clientLogin?: string;
	reportType: string;
	fieldNames: readonly string[];
	/** YYYY-MM-DD, включительно. */
	dateFrom: string;
	dateTo: string;
	filter?: DirectReportFilter[];
}

/** Строка отчёта: значения колонок как есть, по именам из FieldNames. */
export type DirectReportRow = Record<string, string>;

interface DirectErrorResponse {
	error?: {
		error_code: number;
		error_string?: string;
		error_detail?: string;
	};
}

/**
 * В отличие от остальных методов v5 (JSON {result: ...}/{error: ...}),
 * отчёты — отдельный формат: тело ответа при готовности — сырой TSV, не
 * JSON, а обёртки {data:{Rows:[...]}} в реальном API не существует.
 * При processingMode=auto Яндекс может не успеть посчитать отчёт сразу и
 * вернуть 201/202 с заголовком retryIn (секунды) — тогда нужно повторить
 * тот же запрос (тот же ReportName) позже; это штатное поведение API, не ошибка.
 */
async function requestReportOnce(
	params: DirectReportParams,
	reportName: string,
): Promise<{ status: number; retryInSeconds: number | null; body: string }> {
	const res = await fetch(REPORTS_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${params.token}`,
			"Content-Type": "application/json; charset=utf-8",
			processingMode: "auto",
			skipReportHeader: "true",
			skipReportSummary: "true",
			...(params.clientLogin ? { "Client-Login": params.clientLogin } : {}),
		},
		body: JSON.stringify({
			params: {
				SelectionCriteria: {
					DateFrom: params.dateFrom,
					DateTo: params.dateTo,
					...(params.filter?.length ? { Filter: params.filter } : {}),
				},
				FieldNames: params.fieldNames,
				ReportName: reportName,
				ReportType: params.reportType,
				DateRangeType: "CUSTOM_DATE",
				Format: "TSV",
				IncludeVAT: "NO",
				IncludeDiscount: "NO",
			},
		}),
	});
	const body = await res.text();
	const retryInHeader = res.headers.get("retryIn");
	return {
		status: res.status,
		retryInSeconds: retryInHeader ? Number(retryInHeader) : null,
		body,
	};
}

export function parseDirectReportTsv(text: string): DirectReportRow[] {
	const lines = text.trim().split("\n").filter(Boolean);
	const header = lines[0]?.split("\t") ?? [];
	return lines.slice(1).map((line) => {
		const cols = line.split("\t");
		return Object.fromEntries(
			header.map((name, index) => [name, cols[index] ?? ""]),
		);
	});
}

/** Строит отчёт Директа (с ожиданием офлайн-построения) и возвращает строки. */
export async function fetchDirectReport(
	params: DirectReportParams,
): Promise<DirectReportRow[]> {
	const reportName = `psi-opora_${params.reportType}_${Date.now()}`;
	for (let attempt = 0; attempt < REPORT_MAX_ATTEMPTS; attempt++) {
		const { status, retryInSeconds, body } = await requestReportOnce(
			params,
			reportName,
		);
		if (status === 200) return parseDirectReportTsv(body);
		if (status === 201 || status === 202) {
			const waitSeconds = Math.min(
				Math.max(retryInSeconds ?? 2, 1),
				REPORT_MAX_WAIT_SECONDS,
			);
			await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
			continue;
		}
		let message = body;
		try {
			const json = JSON.parse(body) as DirectErrorResponse;
			if (json.error) {
				message = `${json.error.error_code}: ${json.error.error_detail ?? json.error.error_string}`;
			}
		} catch {
			// тело не JSON — оставляем как есть для лога
		}
		throw new Error(`Yandex reports API error (${status}): ${message}`);
	}
	throw new Error(
		"Yandex reports API: отчёт не готов после нескольких попыток",
	);
}
