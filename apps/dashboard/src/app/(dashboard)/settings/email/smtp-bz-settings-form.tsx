"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@psi-opora/api";
import {
	type SmtpBzSettingsInput,
	smtpBzSettingsSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { blankToUndefined } from "@/lib/blank-to-undefined";
import { orpc } from "@/lib/orpc/client";

type SmtpBzSettings = RouterOutputs["email"]["getSmtpBzSettings"];

function toFormValues(settings: SmtpBzSettings): SmtpBzSettingsInput {
	return {
		apiKey: settings?.apiKey ?? "",
		senderEmail: settings?.senderEmail ?? "",
		senderName: settings?.senderName ?? "",
	};
}

export function SmtpBzSettingsForm() {
	const queryClient = useQueryClient();
	const [showApiKey, setShowApiKey] = useState(false);

	const { data: settings, isLoading } = useQuery(
		orpc.email.getSmtpBzSettings.queryOptions(),
	);

	const form = useForm<SmtpBzSettingsInput>({
		resolver: zodResolver(smtpBzSettingsSchema),
		defaultValues: toFormValues(null),
		values: settings === undefined ? undefined : toFormValues(settings),
		resetOptions: { keepDirtyValues: true },
	});

	const mutation = useMutation(
		orpc.email.upsertSmtpBzSettings.mutationOptions({
			onSuccess: () => {
				toast.success("Настройки SMTP.BZ сохранены");
				form.reset(form.getValues());
				queryClient.invalidateQueries({
					queryKey: orpc.email.getSmtpBzSettings.key(),
				});
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось сохранить настройки");
			},
		}),
	);

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit((values) =>
					mutation.mutate(blankToUndefined(values)),
				)}
				className="flex flex-col gap-4"
			>
				<fieldset disabled={isLoading} className="contents">
					<FormField
						control={form.control}
						name="apiKey"
						render={({ field }) => (
							<FormItem>
								<FormLabel className="text-xs text-muted-foreground">
									API-ключ
								</FormLabel>
								<FormControl>
									<div className="relative">
										<Input
											type={showApiKey ? "text" : "password"}
											placeholder="••••••••"
											className="font-mono text-sm pr-10"
											{...field}
										/>
										<button
											type="button"
											onClick={() => setShowApiKey((prev) => !prev)}
											className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
											tabIndex={-1}
										>
											{showApiKey ? (
												<EyeOff className="size-4" />
											) : (
												<Eye className="size-4" />
											)}
										</button>
									</div>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					<div className="grid grid-cols-2 gap-4">
						<FormField
							control={form.control}
							name="senderEmail"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="text-xs text-muted-foreground">
										Email отправителя
									</FormLabel>
									<FormControl>
										<Input
											type="email"
											placeholder="hello@psi-opora.ru"
											className="font-mono text-sm"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="senderName"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="text-xs text-muted-foreground">
										Имя отправителя
									</FormLabel>
									<FormControl>
										<Input
											placeholder="Психологический центр «Опора»"
											className="font-mono text-sm"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</div>

					{settings?.updatedAt && (
						<p className="text-xs text-muted-foreground">
							Сохранено: {new Date(settings.updatedAt).toLocaleString("ru-RU")}
						</p>
					)}

					<Button
						type="submit"
						disabled={mutation.isPending}
						className="self-start"
					>
						{mutation.isPending
							? "Сохраняем…"
							: isLoading
								? "Загрузка…"
								: "Сохранить"}
					</Button>
				</fieldset>
			</form>
		</Form>
	);
}
