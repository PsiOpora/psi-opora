"use client";

import { DownloadIcon, FileSpreadsheetIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv-import";
import { downloadXlsx, type XlsxCell } from "@/lib/xlsx-export";

export interface ReportTable {
	headers: string[];
	rows: XlsxCell[][];
}

type ExportFormat = "csv" | "xlsx";

/**
 * Кнопки «CSV» и «Excel» для отчёта по рассылке. Таблицу строит `load` —
 * вызывается по клику, поэтому отчёты с серверной пагинацией выгружают все
 * строки, а не только открытую страницу. CSV — UTF-8 с BOM и «;» (так его
 * открывает русский Excel), Excel — настоящий .xlsx.
 */
export function ExportReportButtons({
	fileName,
	sheetName,
	load,
}: {
	/** Имя файла без расширения. */
	fileName: string;
	sheetName?: string;
	load: () => Promise<ReportTable>;
}) {
	const [busy, setBusy] = useState<ExportFormat | null>(null);

	async function run(format: ExportFormat) {
		setBusy(format);
		try {
			const { headers, rows } = await load();
			if (rows.length === 0) {
				toast.error("Нет данных для экспорта");
				return;
			}
			if (format === "csv") downloadCsv(`${fileName}.csv`, headers, rows);
			else downloadXlsx(`${fileName}.xlsx`, headers, rows, sheetName);
		} catch (err) {
			toast.error(`Не удалось выгрузить отчёт: ${(err as Error).message}`);
		} finally {
			setBusy(null);
		}
	}

	return (
		<>
			<Button
				variant="outline"
				onClick={() => run("csv")}
				disabled={busy !== null}
			>
				{busy === "csv" ? (
					<Loader2Icon className="animate-spin" />
				) : (
					<DownloadIcon />
				)}
				Отчёт CSV
			</Button>
			<Button
				variant="outline"
				onClick={() => run("xlsx")}
				disabled={busy !== null}
			>
				{busy === "xlsx" ? (
					<Loader2Icon className="animate-spin" />
				) : (
					<FileSpreadsheetIcon />
				)}
				Отчёт Excel
			</Button>
		</>
	);
}
