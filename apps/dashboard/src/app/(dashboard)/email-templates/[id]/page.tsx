"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { orpc } from "@/lib/orpc/client";
import { TemplateEditor } from "../template-editor";

export default function EditEmailTemplatePage() {
	const params = useParams<{ id: string }>();
	const id = params.id;

	const { data: template, isLoading: templateLoading } = useQuery(
		orpc.emailTemplates.get.queryOptions({ input: { id } }),
	);
	const { data: defs = [], isLoading: defsLoading } = useQuery(
		orpc.emailTemplates.listDefs.queryOptions(),
	);

	if (templateLoading || defsLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (!template) {
		return <p className="text-sm text-destructive">Шаблон не найден.</p>;
	}

	const templateDef = defs.find((def) => def.key === template.templateKey);
	if (!templateDef) {
		return (
			<p className="text-sm text-destructive">
				Неизвестный тип шаблона «{template.templateKey}».
			</p>
		);
	}

	return (
		<TemplateEditor templateDef={templateDef} initialTemplate={template} />
	);
}
