"use client";

import type { CampaignTemplateSummary } from "@psi-opora/api";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { orpc } from "@/lib/orpc/client";

const THUMB_WIDTH = 600;
const THUMB_HEIGHT = 750;
const THUMB_SCALE = 0.4;

function TemplateThumbnail({ html }: { html: string | null | undefined }) {
	return (
		<div
			className="relative mx-auto overflow-hidden rounded border bg-white"
			style={{
				width: THUMB_WIDTH * THUMB_SCALE,
				height: THUMB_HEIGHT * THUMB_SCALE,
			}}
		>
			{html && (
				<iframe
					title="Миниатюра шаблона"
					srcDoc={html}
					sandbox=""
					tabIndex={-1}
					className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
					style={{
						width: THUMB_WIDTH,
						height: THUMB_HEIGHT,
						transform: `scale(${THUMB_SCALE})`,
					}}
				/>
			)}
		</div>
	);
}

export function TemplateGallery({
	onSelect,
}: {
	onSelect: (def: CampaignTemplateSummary) => void;
}) {
	const { data: defs = [], isLoading: defsLoading } = useQuery(
		orpc.emailTemplates.listDefs.queryOptions(),
	);
	const { data: previews = [] } = useQuery(
		orpc.emailTemplates.previewDefaults.queryOptions(),
	);

	if (defsLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{defs.map((def) => (
				<Card key={def.key} className="flex flex-col">
					<CardHeader>
						<CardTitle>{def.label}</CardTitle>
						<CardDescription>{def.description}</CardDescription>
					</CardHeader>
					<CardContent className="flex-1">
						<TemplateThumbnail
							html={previews.find((p) => p.key === def.key)?.html}
						/>
					</CardContent>
					<CardFooter>
						<Button className="w-full" onClick={() => onSelect(def)}>
							Выбрать
						</Button>
					</CardFooter>
				</Card>
			))}
		</div>
	);
}
