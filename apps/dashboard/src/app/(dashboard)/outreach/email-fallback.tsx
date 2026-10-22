"use client";

import type { OutreachOptions } from "@psi-opora/api";
import type { EmailTemplate } from "@psi-opora/db/queries";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Последний шаг цепочки: письмо тем, до кого не дошёл ни один мессенджер. */
export function EmailFallback({
	options,
	templates,
	step,
	enabled,
	onEnabledChange,
	templateId,
	onTemplateChange,
	subject,
	onSubjectChange,
}: {
	options: OutreachOptions;
	templates: EmailTemplate[];
	step: number | null;
	enabled: boolean;
	onEnabledChange: (enabled: boolean) => void;
	templateId: string;
	onTemplateChange: (template: EmailTemplate) => void;
	subject: string;
	onSubjectChange: (subject: string) => void;
}) {
	const unavailable =
		"error" in options.email ? (
			options.email.error
		) : templates.length === 0 ? (
			<>
				Нет шаблонов писем —{" "}
				<Link
					href="/email-templates/new"
					className="underline underline-offset-2"
				>
					создайте шаблон
				</Link>
				.
			</>
		) : null;
	const senderEmail = "error" in options.email ? "" : options.email.senderEmail;

	return (
		<div className={cn("rounded-lg border bg-card", !enabled && "bg-muted/30")}>
			<div className="flex flex-wrap items-center gap-3 p-3">
				{/* Место под стрелки — email всегда последний. */}
				<span className="w-6" />
				<span
					className={cn(
						"flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
						step ? "bg-primary text-primary-foreground" : "bg-muted",
					)}
				>
					{step ?? "–"}
				</span>
				<div className="flex min-w-28 items-center gap-2">
					<Switch
						id="outreach-email"
						checked={enabled}
						disabled={Boolean(unavailable)}
						onCheckedChange={onEnabledChange}
					/>
					<Label htmlFor="outreach-email" className="font-medium">
						Email
					</Label>
				</div>
				<p className="text-sm text-muted-foreground">
					{unavailable ??
						`Если мессенджеры не сработали — письмо с ${senderEmail}. Всегда последний шаг: письма уходят одной email-кампанией в конце.`}
				</p>
			</div>
			{enabled && !unavailable && (
				<div className="grid grid-cols-1 gap-3 border-t p-3 md:grid-cols-2">
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs text-muted-foreground">
							Шаблон письма
						</Label>
						<Select
							value={templateId}
							onValueChange={(value) => {
								const template = templates.find((t) => t.id === value);
								if (template) onTemplateChange(template);
							}}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Выберите шаблон" />
							</SelectTrigger>
							<SelectContent>
								{templates.map((t) => (
									<SelectItem key={t.id} value={t.id}>
										{t.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label
							htmlFor="outreach-subject"
							className="text-xs text-muted-foreground"
						>
							Тема письма
						</Label>
						<Input
							id="outreach-subject"
							value={subject}
							onChange={(e) => onSubjectChange(e.target.value)}
							maxLength={300}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
