"use client";

import { CircleAlertIcon, FileIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PendingAttachment {
	file: File;
	status: "uploading" | "ready" | "error";
	error?: string;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} Б`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Выбранный файл над полем ввода: миниатюра для картинок, имя, размер и
 * состояние загрузки. Крестик убирает вложение (и прерывает загрузку). */
export function AttachmentPreview({
	attachment,
	onRemove,
}: {
	attachment: PendingAttachment;
	onRemove: () => void;
}) {
	const { file, status, error } = attachment;
	const [thumb, setThumb] = useState<string | null>(null);

	useEffect(() => {
		if (!file.type.startsWith("image/")) {
			setThumb(null);
			return;
		}
		const url = URL.createObjectURL(file);
		setThumb(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	return (
		<div
			className={cn(
				"flex items-center gap-3 rounded-xl border bg-muted/40 p-2 pr-1.5",
				status === "error" && "border-destructive/40 bg-destructive/5",
			)}
		>
			{thumb ? (
				// biome-ignore lint/performance/noImgElement: локальный blob-URL, next/image не нужен
				<img
					src={thumb}
					alt=""
					className="size-12 shrink-0 rounded-lg object-cover"
				/>
			) : (
				<div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
					<FileIcon className="size-5" />
				</div>
			)}
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{file.name}</p>
				<p
					className={cn(
						"flex items-center gap-1.5 text-xs",
						status === "error" ? "text-destructive" : "text-muted-foreground",
					)}
				>
					{status === "uploading" && (
						<>
							<Loader2Icon className="size-3 animate-spin" />
							Загружаем…
						</>
					)}
					{status === "ready" && formatSize(file.size)}
					{status === "error" && (
						<>
							<CircleAlertIcon className="size-3" />
							{error ?? "Не удалось загрузить файл"}
						</>
					)}
				</p>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				title="Убрать вложение"
				aria-label="Убрать вложение"
				onClick={onRemove}
			>
				<XIcon />
			</Button>
		</div>
	);
}
