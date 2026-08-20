"use client";

import type { CampaignTemplateSummary } from "@psi-opora/api";
import { useState } from "react";
import { TemplateEditor } from "../template-editor";
import { TemplateGallery } from "../template-gallery";

export default function NewEmailTemplatePage() {
	const [templateDef, setTemplateDef] =
		useState<CampaignTemplateSummary | null>(null);

	if (!templateDef) {
		return (
			<div className="flex flex-col gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Выберите шаблон</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Дизайн уже готов — останется заполнить текст.
					</p>
				</div>
				<TemplateGallery onSelect={setTemplateDef} />
			</div>
		);
	}

	return <TemplateEditor templateDef={templateDef} />;
}
