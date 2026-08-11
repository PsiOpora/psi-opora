"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { orpc } from "@/lib/orpc/client";

interface UploadResponse {
	ok?: boolean;
	error?: string;
}

/** Загрузка через XHR (не server action), чтобы показать прогресс отправки файла. */
export function GuideUploadForm() {
	const queryClient = useQueryClient();
	const formRef = useRef<HTMLFormElement>(null);
	const [progress, setProgress] = useState<number | null>(null);

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		const file = formData.get("guide");
		if (!(file instanceof File) || file.size === 0) {
			toast.error("Выберите PDF-файл");
			return;
		}

		setProgress(0);
		const xhr = new XMLHttpRequest();
		xhr.open("POST", "/api/guide/upload");

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) {
				setProgress(Math.round((e.loaded / e.total) * 100));
			}
		};

		xhr.onload = () => {
			setProgress(null);
			let data: UploadResponse = {};
			try {
				data = JSON.parse(xhr.responseText);
			} catch {
				// тело ответа не JSON — используем статус ниже
			}
			if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
				toast.success("Гайд добавлен в библиотеку");
				formRef.current?.reset();
				queryClient.invalidateQueries({ queryKey: orpc.bot.listGuides.key() });
			} else {
				toast.error(data.error ?? "Не удалось загрузить файл");
			}
		};

		xhr.onerror = () => {
			setProgress(null);
			toast.error("Не удалось загрузить файл — проверьте соединение");
		};

		xhr.send(formData);
	};

	return (
		<form
			ref={formRef}
			onSubmit={onSubmit}
			className="flex flex-col gap-3 rounded-lg bg-muted/40 p-4"
		>
			<div>
				<p className="text-sm font-medium">Добавить новый гайд</p>
				<p className="text-xs text-muted-foreground">
					Укажите понятное название и выберите PDF-файл.
				</p>
			</div>
			<div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
				<Input
					type="text"
					name="title"
					placeholder="Название гайда, например «Для родителей детей»"
					disabled={progress !== null}
					className="text-sm"
				/>
				<Input
					type="file"
					name="guide"
					accept="application/pdf"
					required
					disabled={progress !== null}
					className="text-sm"
				/>
				<Button type="submit" variant="secondary" disabled={progress !== null}>
					<Upload data-icon="inline-start" />
					{progress !== null ? "Загружаем…" : "Добавить гайд"}
				</Button>
			</div>
			{progress !== null && (
				<div className="flex max-w-xs items-center gap-2">
					<Progress value={progress} className="h-1.5" />
					<span className="text-xs text-muted-foreground tabular-nums">
						{progress}%
					</span>
				</div>
			)}
		</form>
	);
}
