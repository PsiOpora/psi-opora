"use client";

import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

function escapeCell(value: string | number): string {
	const text = String(value);
	// CSV formula injection protection: prefix strings starting with =, +, -, @ with apostrophe
	const needsPrefix = typeof value === "string" && /^[=+\-@]/.test(text);
	const prefixed = needsPrefix ? `'${text}` : text;
	return /[";\n]/.test(prefixed)
		? `"${prefixed.replace(/"/g, '""')}"`
		: prefixed;
}

export function ExportCsvButton({
	filename,
	headers,
	rows,
	getRows,
}: {
	filename: string;
	headers: string[];
	/** Готовые строки — для случаев, когда весь набор данных уже на клиенте. */
	rows?: Array<Array<string | number>>;
	/** Загрузка всех строк по требованию — для серверно-пагинированных отчётов,
	 * где на клиенте есть только текущая страница. */
	getRows?: () => Promise<Array<Array<string | number>>>;
}) {
	const [loading, setLoading] = useState(false);

	async function download() {
		let data: Array<Array<string | number>>;
		if (getRows) {
			setLoading(true);
			try {
				data = await getRows();
			} catch {
				toast.error("Не удалось выгрузить данные для CSV");
				return;
			} finally {
				setLoading(false);
			}
		} else {
			data = rows ?? [];
		}

		if (data.length === 0) {
			toast.error("Нет данных для экспорта");
			return;
		}
		// BOM + ";" — чтобы русский Excel открывал файл без настройки импорта
		const bom = String.fromCharCode(0xfeff);
		const csv =
			bom +
			[headers, ...data]
				.map((row) => row.map(escapeCell).join(";"))
				.join("\r\n");
		const url = URL.createObjectURL(
			new Blob([csv], { type: "text/csv;charset=utf-8" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
		toast.success(`Файл ${filename} скачан`);
	}

	return (
		<Button variant="outline" size="sm" onClick={download} disabled={loading}>
			{loading ? (
				<Loader2Icon data-icon="inline-start" className="animate-spin" />
			) : (
				<DownloadIcon data-icon="inline-start" />
			)}
			CSV
		</Button>
	);
}
