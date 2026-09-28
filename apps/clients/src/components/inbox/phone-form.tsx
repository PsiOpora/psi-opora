"use client";

import type { CrmContactRef, PhoneHint } from "@psi-opora/api";
import { formatPhone, normalizePhone } from "@psi-opora/api/schemas";
import {
	ExternalLinkIcon,
	Loader2Icon,
	MessageSquareTextIcon,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatListTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Номер уже есть у контактов CRM, а у диалога контакта нет — оператор
 * решает: привязать диалог к одному из них или завести новый контакт. */
function ConflictChoice({
	contacts,
	saving,
	onLink,
	onCreate,
	onCancel,
}: {
	contacts: CrmContactRef[];
	saving: boolean;
	onLink: (contactId: string) => void;
	onCreate: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm">
			<p className="text-xs">
				Этот номер уже есть в CRM. Если это тот же человек — привяжите диалог к
				его контакту, чтобы история и сделки были в одной карточке.
			</p>
			{contacts.map((contact) => (
				<div
					key={contact.id}
					className="flex items-center justify-between gap-2"
				>
					{contact.url ? (
						<a
							href={contact.url}
							target="_blank"
							rel="noreferrer"
							className="min-w-0 truncate text-primary hover:underline"
						>
							{contact.name}
							<ExternalLinkIcon className="ml-0.5 inline size-3 align-baseline" />
						</a>
					) : (
						<span className="min-w-0 truncate">{contact.name}</span>
					)}
					<Button
						size="xs"
						disabled={saving}
						onClick={() => onLink(contact.id)}
					>
						Привязать
					</Button>
				</div>
			))}
			<div className="flex gap-1.5">
				<Button
					size="xs"
					variant="outline"
					disabled={saving}
					onClick={onCreate}
				>
					Создать новый контакт
				</Button>
				<Button size="xs" variant="ghost" disabled={saving} onClick={onCancel}>
					Отмена
				</Button>
			</div>
		</div>
	);
}

function hintLabel(hint: PhoneHint): string {
	if (hint.source === "whatsapp") return "номер WhatsApp";
	return hint.messageAt
		? `из сообщения ${formatListTime(hint.messageAt)}`
		: "из переписки";
}

/**
 * Поле ввода телефона с живой проверкой формата и подсказками — номерами,
 * которые уже встречались в диалоге (WhatsApp-номер клиента, телефон из его
 * сообщения). Клик по подсказке подставляет номер в поле, сохраняет —
 * Enter или кнопка, чтобы оператор успел глазами проверить номер.
 */
export function PhoneForm({
	value,
	onChange,
	hints,
	conflict,
	saving,
	onSave,
	onCancel,
	onLink,
	onCreate,
	autoFocus,
}: {
	value: string;
	onChange: (value: string) => void;
	hints: PhoneHint[];
	conflict: CrmContactRef[] | null;
	saving: boolean;
	onSave: () => void;
	onCancel?: () => void;
	onLink: (contactId: string) => void;
	onCreate: () => void;
	autoFocus?: boolean;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const normalized = normalizePhone(value);
	const showInvalid = value.trim().length > 0 && !normalized;

	if (conflict) {
		return (
			<ConflictChoice
				contacts={conflict}
				saving={saving}
				onLink={onLink}
				onCreate={onCreate}
				onCancel={() => onCancel?.()}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex gap-1.5">
				<Input
					ref={inputRef}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							if (normalized) onSave();
						}
						if (e.key === "Escape" && onCancel) onCancel();
					}}
					type="tel"
					inputMode="tel"
					autoComplete="off"
					autoFocus={autoFocus}
					placeholder="+7 999 123-45-67"
					aria-invalid={showInvalid || undefined}
					className="h-8 text-sm"
				/>
				<Button
					size="default"
					disabled={!normalized || saving}
					onClick={onSave}
				>
					{saving ? <Loader2Icon className="animate-spin" /> : "Сохранить"}
				</Button>
			</div>

			<p
				className={cn(
					"min-h-4 text-xs",
					showInvalid ? "text-destructive" : "text-muted-foreground",
				)}
			>
				{showInvalid
					? "Нужно 10–15 цифр, можно с пробелами, скобками и дефисами"
					: normalized && normalized !== value.trim()
						? `Сохраним как ${formatPhone(normalized)}`
						: onCancel
							? "Enter — сохранить, Esc — отмена"
							: "Номер попадёт в контакт клиента в CRM"}
			</p>

			{hints.length > 0 && (
				<div className="flex flex-col gap-1">
					<span className="text-xs text-muted-foreground">
						Нашли в диалоге:
					</span>
					<div className="flex flex-wrap gap-1">
						{hints.map((hint) => (
							<button
								key={hint.phone}
								type="button"
								onClick={() => {
									onChange(formatPhone(hint.phone));
									inputRef.current?.focus();
								}}
								title="Подставить в поле"
								className={cn(
									"flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted",
									normalized === hint.phone && "border-primary bg-primary/5",
								)}
							>
								<MessageSquareTextIcon className="size-3 text-muted-foreground" />
								<span className="font-medium">{formatPhone(hint.phone)}</span>
								<span className="text-muted-foreground">{hintLabel(hint)}</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
