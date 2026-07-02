"use client";

import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function ExportCsvButton({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  function download() {
    // BOM + ";" — чтобы русский Excel открывал файл без настройки импорта
    const bom = String.fromCharCode(0xfeff);
    const csv = bom + [headers, ...rows].map((row) => row.map(escapeCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={download}>
      <DownloadIcon data-icon="inline-start" />
      CSV
    </Button>
  );
}
