"use client";

import type { ScenarioTextDef } from "@psi-opora/bot-core";
import { useQuery } from "@tanstack/react-query";
import {
	BookOpen,
	Bot,
	ChevronDown,
	ExternalLink,
	FileText,
	Info,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { orpc } from "@/lib/orpc/client";
import { BotTextsForm } from "./bot-texts-form";
import {
	DeleteGuideButton,
	SendTestGuideButton,
	SetActiveGuideButton,
} from "./guide-actions";
import { GuideUploadForm } from "./guide-upload-form";

function groupDefs(
	defs: ScenarioTextDef[],
): Array<{ group: string; defs: ScenarioTextDef[] }> {
	const groups: Array<{ group: string; defs: ScenarioTextDef[] }> = [];
	for (const def of defs) {
		const existing = groups.find((g) => g.group === def.group);
		if (existing) existing.defs.push(def);
		else groups.push({ group: def.group, defs: [def] });
	}
	return groups;
}

function formatSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "";
	return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function GuidesLibraryCard({
	guides,
	activeS3Key,
}: {
	guides: Array<{
		id: string;
		title: string;
		fileName: string;
		fileUrl: string;
		fileSize: number;
		s3Key: string;
	}>;
	activeS3Key: string;
}) {
	const [open, setOpen] = useState(false);
	const activeGuide = guides.find((guide) => guide.s3Key === activeS3Key);

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center gap-4">
						<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
							<BookOpen />
						</div>
						<div className="min-w-0 flex-1">
							<CardTitle>PDF-гайды</CardTitle>
							<CardDescription className="mt-1">
								{activeGuide
									? `Сейчас отправляется: «${activeGuide.title}»`
									: "Активный гайд не выбран"}
							</CardDescription>
						</div>
						<SendTestGuideButton />
						<CollapsibleTrigger asChild>
							<Button type="button" variant="ghost" size="sm">
								{open ? "Скрыть" : "Управлять"}
								<ChevronDown
									data-icon="inline-end"
									className={open ? "rotate-180" : undefined}
								/>
							</Button>
						</CollapsibleTrigger>
					</div>
				</CardHeader>
				<CollapsibleContent>
					<CardContent className="flex flex-col gap-4 border-t pt-6">
						<Alert>
							<Info />
							<AlertDescription>
								Активный PDF приходит клиенту на email, а в MAX ещё и в чат.
								Формат — PDF до 10 МБ.
							</AlertDescription>
						</Alert>
						{guides.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								Гайдов пока нет — бот отправит только текст гайда без вложения.
							</p>
						) : (
							<div className="flex flex-col gap-2">
								{guides.map((guide) => {
									const isActive = guide.s3Key === activeS3Key;
									return (
										<div
											key={guide.id}
											className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-3"
										>
											<div className="flex min-w-0 items-center gap-3">
												<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
													<FileText />
												</div>
												<div className="flex min-w-0 flex-col gap-0.5">
													<div className="flex items-center gap-2">
														<a
															href={guide.fileUrl}
															target="_blank"
															rel="noreferrer"
															className="truncate text-sm font-medium hover:underline"
														>
															{guide.title}{" "}
															<ExternalLink className="inline size-3" />
														</a>
														{isActive && (
															<Badge className="text-[10px]">активен</Badge>
														)}
													</div>
													<span className="text-xs text-muted-foreground">
														{guide.fileName} · {formatSize(guide.fileSize)}
													</span>
												</div>
											</div>
											<div className="flex items-center gap-2">
												{!isActive && (
													<SetActiveGuideButton
														id={guide.id}
														title={guide.title}
													/>
												)}
												<DeleteGuideButton
													id={guide.id}
													title={guide.title}
													isActive={isActive}
												/>
											</div>
										</div>
									);
								})}
							</div>
						)}

						<GuideUploadForm />
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>
	);
}

export default function BotTextsPage() {
	const { data: overrides = {} } = useQuery(orpc.bot.getTexts.queryOptions());
	const { data: guides = [] } = useQuery(orpc.bot.listGuides.queryOptions());
	const { data: defsData } = useQuery({
		queryKey: ["dashboard-bot-texts-defs"],
		queryFn: async () => {
			const res = await fetch("/api/dashboard/bot-texts-defs");
			if (!res.ok) throw new Error("Не удалось загрузить тексты бота");
			return (await res.json()) as {
				defs: ScenarioTextDef[];
				guideFileS3Key: string;
			};
		},
	});
	const groups = groupDefs(defsData?.defs ?? []);
	const activeS3Key = defsData
		? (overrides[defsData.guideFileS3Key]?.trim() ?? "")
		: "";

	return (
		<div className="flex max-w-6xl flex-col gap-6">
			<div className="flex items-start gap-3">
				<div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
					<Bot />
				</div>
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Тексты бота</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Настройте сообщения Telegram и MAX. Изменения применятся в течение
						минуты.
					</p>
				</div>
			</div>

			<GuidesLibraryCard guides={guides} activeS3Key={activeS3Key} />

			<BotTextsForm groups={groups} initialOverrides={overrides} />
		</div>
	);
}
