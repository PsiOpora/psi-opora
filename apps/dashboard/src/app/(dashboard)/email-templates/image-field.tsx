"use client";

import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Предупреждаем о тяжёлых картинках: письма больше ~100 КБ HTML+картинок чаще попадают в спам. */
const HEAVY_IMAGE_BYTES = 1024 * 1024;

/**
 * Поле «картинка» email-шаблона: загрузка файла в наше S3 (публичная
 * ссылка /api/email-image/...) или вставка готового URL.
 */
export function ImageField({
	id,
	value,
	onChange,
}: {
	id: string;
	value: string;
	onChange: (url: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);

	const upload = async (file: File | undefined) => {
		if (!file) return;
		setUploading(true);
		try {
			const form = new FormData();
			form.append("image", file);
			const res = await fetch("/api/email-image/upload", {
				method: "POST",
				body: form,
			});
			const json = (await res.json().catch(() => ({}))) as {
				url?: string;
				error?: string;
			};
			if (!res.ok || !json.url) {
				throw new Error(json.error ?? `Ошибка загрузки (HTTP ${res.status})`);
			}
			onChange(json.url);
			if (file.size > HEAVY_IMAGE_BYTES) {
				toast.warning(
					"Картинка загружена, но она тяжёлая (больше 1 МБ) — у получателей письмо будет открываться медленно. Лучше сжать до 200–300 КБ.",
				);
			} else {
				toast.success("Картинка загружена");
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setUploading(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	return (
		<div className="flex flex-col gap-2">
			{value ? (
				<div className="flex items-start gap-3 rounded-md border p-2">
					{/* biome-ignore lint/performance/noImgElement: превью внешнего URL, next/image тут не нужен */}
					<img
						src={value}
						alt="Картинка письма"
						className="h-20 w-32 shrink-0 rounded object-cover"
					/>
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<span
							className="truncate text-xs text-muted-foreground"
							title={value}
						>
							{value}
						</span>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={uploading}
								onClick={() => inputRef.current?.click()}
							>
								<UploadIcon />
								Заменить
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => onChange("")}
							>
								<Trash2Icon />
								Убрать
							</Button>
						</div>
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-2 sm:flex-row">
					<Button
						type="button"
						variant="outline"
						disabled={uploading}
						onClick={() => inputRef.current?.click()}
					>
						{uploading ? (
							<ImageIcon className="animate-pulse" />
						) : (
							<UploadIcon />
						)}
						{uploading ? "Загружаем…" : "Загрузить картинку"}
					</Button>
					<Input
						id={id}
						type="url"
						placeholder="или вставьте ссылку https://…"
						onBlur={(e) => {
							const url = e.target.value.trim();
							if (url) onChange(url);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								const url = e.currentTarget.value.trim();
								if (url) onChange(url);
							}
						}}
					/>
				</div>
			)}
			<p className="text-xs text-muted-foreground">
				JPG, PNG или GIF до 5 МБ. Оптимально — ширина 930 px (вдвое больше
				ширины письма, чтобы было чётко на ретина-экранах) и вес до 300 КБ.
			</p>
			<input
				ref={inputRef}
				type="file"
				accept="image/png,image/jpeg,image/gif"
				className="sr-only"
				onChange={(e) => upload(e.target.files?.[0])}
			/>
		</div>
	);
}
