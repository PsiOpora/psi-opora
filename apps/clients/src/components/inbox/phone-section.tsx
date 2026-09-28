"use client";

import type {
	CrmContactRef,
	CrmPhone,
	SetClientPhoneResult,
} from "@psi-opora/api";
import { formatPhone, normalizePhone } from "@psi-opora/api/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, PencilIcon, PhoneIcon, PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PhoneForm } from "@/components/inbox/phone-form";
import type { SelectedClient } from "@/components/inbox/thread-pane";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc, orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

/** Что редактируем: новый номер (valueId отсутствует) или конкретный
 * сохранённый — исправить опечатку. */
type Editing = { valueId?: string } | null;

function successMessage(
	result: Extract<SetClientPhoneResult, { ok: true }>,
): string {
	const name = result.contact.name;
	switch (result.outcome) {
		case "added":
			return `Телефон добавлен в контакт «${name}»`;
		case "updated":
			return "Телефон исправлен в CRM";
		case "unchanged":
			return `Этот номер уже есть у контакта «${name}»`;
		case "linked":
			return `Диалог привязан к контакту «${name}» из CRM`;
		case "created":
			return `В CRM создан контакт «${name}» с этим телефоном`;
	}
}

function PhoneRow({
	phone,
	onEdit,
}: {
	phone: CrmPhone;
	onEdit: (() => void) | null;
}) {
	const normalized = normalizePhone(phone.value);
	const display = normalized ? formatPhone(normalized) : phone.value;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(normalized ?? phone.value);
			toast.success("Номер скопирован");
		} catch {
			toast.error("Браузер не дал скопировать номер");
		}
	};

	return (
		<div className="group flex items-center justify-between gap-2 text-sm">
			<a
				href={`tel:${normalized ?? phone.value}`}
				className="font-medium text-primary hover:underline"
			>
				{display}
			</a>
			<div className="flex gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
				<button
					type="button"
					onClick={copy}
					title="Скопировать"
					className="hover:text-foreground"
				>
					<CopyIcon className="size-3.5" />
				</button>
				{onEdit && (
					<button
						type="button"
						onClick={onEdit}
						title="Исправить номер"
						className="hover:text-foreground"
					>
						<PencilIcon className="size-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}

/**
 * Телефон клиента из контакта CRM — наверху карточки, потому что без него
 * оператор не может перезвонить, а сделка не склеится с другими обращениями.
 * Если клиент не оставил номер боту, блок сразу показывает поле ввода и
 * подсказки из переписки; сохранение пишет номер в контакт Bitrix24 (а при
 * отсутствии контакта — находит его по номеру или создаёт), см.
 * packages/api/src/routers/messages/client-phone.ts.
 */
export function PhoneSection({ selected }: { selected: SelectedClient }) {
	const queryClient = useQueryClient();
	const input = { messenger: selected.messenger, userId: selected.userId };

	// Тот же ключ, что у CrmSection, — один запрос в CRM на обе секции.
	const crm = useQuery(
		orpc.messages.crmLinks.queryOptions({ input, staleTime: 60_000 }),
	);
	const phones = crm.data?.contact?.phones ?? [];
	const missing = !crm.isLoading && !crm.data?.error && phones.length === 0;

	const [editing, setEditing] = useState<Editing>(null);
	const [value, setValue] = useState("");
	const [conflict, setConflict] = useState<CrmContactRef[] | null>(null);
	const [pendingLink, setPendingLink] = useState<Extract<
		SetClientPhoneResult,
		{ ok: true }
	> | null>(null);
	const [saving, startSaving] = useTransition();

	const formOpen = missing || editing !== null;
	const hints = useQuery(
		orpc.messages.phoneHints.queryOptions({
			input,
			enabled: formOpen,
			staleTime: 60_000,
		}),
	);
	const knownHints = (hints.data?.hints ?? []).filter(
		(hint) => !phones.some((p) => normalizePhone(p.value) === hint.phone),
	);

	const reset = () => {
		setEditing(null);
		setValue("");
		setConflict(null);
	};

	const save = (
		extra: { linkContactId?: string; createNew?: boolean } = {},
	) => {
		if (saving || pendingLink) return;
		startSaving(async () => {
			let result: SetClientPhoneResult;
			try {
				result = await orpcClient.messages.setClientPhone({
					...input,
					phone: value,
					replaceValueId: editing?.valueId,
					...extra,
				});
			} catch (err) {
				toast.error((err as Error).message || "Не удалось сохранить телефон");
				return;
			}

			if (!result.ok) {
				if ("conflict" in result) setConflict(result.conflict);
				else toast.error(result.error);
				return;
			}

			if (result.linkError) {
				setPendingLink(result);
			} else {
				toast.success(successMessage(result));
			}
			if (result.duplicates.length > 0) {
				toast.warning(
					`Этот номер есть и у других контактов CRM: ${result.duplicates
						.map((c) => c.name)
						.join(", ")}. Возможно, их стоит объединить в Битрикс24.`,
				);
			}
			reset();
			await queryClient.invalidateQueries({
				queryKey: orpc.messages.crmLinks.key({ input }),
			});
		});
	};

	const retryLink = () => {
		if (saving || !pendingLink) return;
		startSaving(async () => {
			try {
				const result = await orpcClient.messages.retryClientPhoneLink({
					...input,
					contactId: pendingLink.contact.id,
					dealId: pendingLink.dealId,
				});
				if (result.linkError) {
					setPendingLink({ ...pendingLink, linkError: result.linkError });
					return;
				}
				setPendingLink(null);
				toast.success("Диалог привязан к контакту CRM");
				await queryClient.invalidateQueries({
					queryKey: orpc.messages.crmLinks.key({ input }),
				});
			} catch (err) {
				toast.error((err as Error).message || "Не удалось привязать диалог");
			}
		});
	};

	return (
		<div
			className={cn(
				"flex flex-col gap-2",
				missing &&
					"rounded-lg border border-dashed border-amber-500/60 bg-amber-500/5 p-3",
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
					<PhoneIcon className="size-3.5" />
					Телефон
				</div>
				{phones.length > 0 && editing === null && !pendingLink && (
					<button
						type="button"
						onClick={() => setEditing({})}
						title="Добавить ещё один номер"
						className="text-muted-foreground hover:text-foreground"
					>
						<PlusIcon className="size-3.5" />
					</button>
				)}
			</div>

			{pendingLink ? (
				<div className="flex flex-col gap-2 text-xs" role="status">
					<p>
						Телефон {formatPhone(pendingLink.phone)} сохранён в контакте «
						{pendingLink.contact.name}» в CRM.
					</p>
					<p className="text-destructive">{pendingLink.linkError}</p>
					<Button
						size="xs"
						variant="outline"
						disabled={saving}
						onClick={retryLink}
					>
						Повторить привязку
					</Button>
				</div>
			) : crm.isLoading ? (
				<Skeleton className="h-5 w-32" />
			) : crm.data?.error ? (
				<p className="text-xs text-destructive">
					Не удалось получить телефон из CRM: {crm.data.error}
				</p>
			) : (
				<>
					{missing && (
						<p className="text-xs text-muted-foreground">
							Клиент не оставил номер. Впишите его — он сохранится в контакте
							CRM, и бот больше не будет спрашивать телефон.
						</p>
					)}

					{editing?.valueId === undefined &&
						phones.map((phone) => (
							<PhoneRow
								key={phone.id ?? phone.value}
								phone={phone}
								onEdit={
									phone.id
										? () => {
												setEditing({ valueId: phone.id ?? undefined });
												setValue(phone.value);
												setConflict(null);
											}
										: null
								}
							/>
						))}

					{formOpen && (
						<PhoneForm
							value={value}
							onChange={setValue}
							hints={knownHints}
							conflict={conflict}
							saving={saving}
							onSave={() => save()}
							onCancel={missing && !conflict ? undefined : reset}
							onLink={(contactId) => save({ linkContactId: contactId })}
							onCreate={() => save({ createNew: true })}
							autoFocus={editing !== null}
						/>
					)}
				</>
			)}
		</div>
	);
}
