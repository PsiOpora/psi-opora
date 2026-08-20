"use client";

import type { CampaignTemplateSummary } from "@psi-opora/api";
import type { EmailTemplate } from "@psi-opora/db/queries";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc/client";

export function TemplateEditor({
	templateDef,
	initialTemplate,
}: {
	templateDef: CampaignTemplateSummary;
	initialTemplate?: EmailTemplate;
}) {
	const router = useRouter();
	const [title, setTitle] = useState(initialTemplate?.title ?? "");
	const [subject, setSubject] = useState(initialTemplate?.subject ?? "");
	const [fields, setFields] = useState<Record<string, string>>(
		initialTemplate?.fields ?? templateDef.defaultValues,
	);
	const [textareaRefs] = useState(
		() => new Map<string, HTMLTextAreaElement | null>(),
	);

	const deferredFields = useDeferredValue(fields);
	const { data: preview, isFetching: previewLoading } = useQuery(
		orpc.emailTemplates.renderPreview.queryOptions({
			input: { templateKey: templateDef.key, fields: deferredFields },
		}),
	);

	const mutation = useMutation(
		orpc.emailTemplates.save.mutationOptions({
			onSuccess: () => {
				toast.success("Шаблон сохранён");
				router.push("/email-templates");
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось сохранить шаблон");
			},
		}),
	);

	const setField = (key: string, value: string) => {
		setFields((prev) => ({ ...prev, [key]: value }));
	};

	const insertPlaceholder = (fieldKey: string, placeholder: string) => {
		const el = textareaRefs.get(fieldKey);
		const current = fields[fieldKey] ?? "";
		if (!el) {
			setField(fieldKey, current + placeholder);
			return;
		}
		const start = el.selectionStart ?? current.length;
		const end = el.selectionEnd ?? current.length;
		const next = current.slice(0, start) + placeholder + current.slice(end);
		setField(fieldKey, next);
		requestAnimationFrame(() => {
			el.focus();
			const caret = start + placeholder.length;
			el.setSelectionRange(caret, caret);
		});
	};

	const canSave = title.trim().length > 0 && subject.trim().length > 0;

	const save = () => {
		mutation.mutate({
			id: initialTemplate?.id,
			title: title.trim(),
			subject: subject.trim(),
			templateKey: templateDef.key,
			fields,
		});
	};

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>
						{initialTemplate ? "Редактирование шаблона" : "Новый шаблон"} —{" "}
						{templateDef.label}
					</CardTitle>
					<CardDescription>
						Заполните поля ниже — вёрстку и HTML писать не нужно. Доступны
						переменные <code className="text-xs">{"{{name}}"}</code> (имя
						контакта) и <code className="text-xs">{"{{email}}"}</code> (email
						получателя) — подставляются автоматически при отправке.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label
								htmlFor="template-title"
								className="text-xs text-muted-foreground"
							>
								Название шаблона
							</Label>
							<Input
								id="template-title"
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								placeholder="Например: Приветственное письмо"
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label
								htmlFor="template-subject"
								className="text-xs text-muted-foreground"
							>
								Тема письма
							</Label>
							<Input
								id="template-subject"
								value={subject}
								onChange={(e) => setSubject(e.target.value)}
								placeholder="Тема, которую увидит получатель"
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
						<div className="flex flex-col gap-4">
							{templateDef.fields.map((fieldDef) => (
								<div key={fieldDef.key} className="flex flex-col gap-1.5">
									<div className="flex items-center justify-between gap-2">
										<Label
											htmlFor={`field-${fieldDef.key}`}
											className="text-xs text-muted-foreground"
										>
											{fieldDef.label}
										</Label>
										{fieldDef.type === "textarea" && (
											<div className="flex gap-1">
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() =>
														insertPlaceholder(fieldDef.key, "{{name}}")
													}
												>
													+ {"{{name}}"}
												</Button>
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() =>
														insertPlaceholder(fieldDef.key, "{{email}}")
													}
												>
													+ {"{{email}}"}
												</Button>
											</div>
										)}
									</div>
									{fieldDef.type === "textarea" ? (
										<Textarea
											id={`field-${fieldDef.key}`}
											ref={(el) => {
												textareaRefs.set(fieldDef.key, el);
											}}
											value={fields[fieldDef.key] ?? ""}
											onChange={(e) => setField(fieldDef.key, e.target.value)}
											placeholder={fieldDef.placeholder}
											className="min-h-32"
										/>
									) : (
										<Input
											id={`field-${fieldDef.key}`}
											type={fieldDef.type === "url" ? "url" : "text"}
											value={fields[fieldDef.key] ?? ""}
											onChange={(e) => setField(fieldDef.key, e.target.value)}
											placeholder={fieldDef.placeholder}
										/>
									)}
								</div>
							))}
						</div>
						<div className="flex flex-col gap-1.5">
							<Label className="text-xs text-muted-foreground">Превью</Label>
							<div className="rounded-md border overflow-hidden bg-white min-h-96">
								{previewLoading && !preview?.html ? (
									<p className="p-3 text-sm text-muted-foreground">
										Загрузка превью…
									</p>
								) : preview?.html ? (
									<iframe
										title="Превью письма"
										srcDoc={preview.html}
										sandbox=""
										className="h-full w-full min-h-96"
									/>
								) : (
									<p className="p-3 text-sm text-muted-foreground">
										Заполните поля, чтобы увидеть превью.
									</p>
								)}
							</div>
						</div>
					</div>

					<div className="flex gap-2">
						<Button
							type="button"
							disabled={!canSave || mutation.isPending}
							onClick={save}
						>
							{mutation.isPending ? "Сохраняем…" : "Сохранить"}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => router.push("/email-templates")}
						>
							Отмена
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
