"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export type DealFieldCodes = Record<string, string | undefined>;

export interface DealFieldOption {
	name: string;
	label: string;
	hint?: string;
}

/**
 * Форма кодов пользовательских полей сделки Bitrix (UF_CRM_…) для набора
 * данных: каждое поле — отдельный код, пустое — бот это поле не пишет.
 */
export function DealFieldCodesCard({
	title,
	description,
	fields,
	schema,
	savedCodes,
	updatedAt,
	isPending,
	onSave,
}: {
	title: string;
	description: ReactNode;
	fields: DealFieldOption[];
	schema: z.ZodType<DealFieldCodes, DealFieldCodes>;
	savedCodes: Partial<Record<string, string>> | undefined;
	updatedAt: Date | string | null | undefined;
	isPending: boolean;
	onSave: (codes: DealFieldCodes) => Promise<unknown>;
}) {
	const form = useForm<DealFieldCodes>({
		resolver: zodResolver(schema),
		defaultValues: Object.fromEntries(
			fields.map(({ name }) => [name, savedCodes?.[name] ?? ""]),
		),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(async (values) => {
							await onSave(values);
							// Сбрасывает флаг «изменено», оставляя введённые значения.
							form.reset(values);
						})}
						className="flex flex-col gap-4"
					>
						<div className="grid grid-cols-2 gap-4">
							{fields.map(({ name, label, hint }) => (
								<FormField
									key={name}
									control={form.control}
									name={name}
									render={({ field }) => (
										<FormItem>
											<FormLabel className="text-xs text-muted-foreground">
												{label}
											</FormLabel>
											<FormControl>
												<Input
													placeholder="UF_CRM_1234567890"
													className="font-mono text-sm"
													{...field}
													value={field.value ?? ""}
												/>
											</FormControl>
											{hint && (
												<FormDescription className="text-xs">
													{hint}
												</FormDescription>
											)}
											<FormMessage />
										</FormItem>
									)}
								/>
							))}
						</div>

						{updatedAt && (
							<p className="text-xs text-muted-foreground">
								Сохранено: {new Date(updatedAt).toLocaleString("ru-RU")}
							</p>
						)}

						<Button type="submit" disabled={isPending} className="self-start">
							{isPending ? "Сохраняем…" : "Сохранить"}
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
