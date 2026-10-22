"use client";

import type { OutreachOptions } from "@psi-opora/api";
import { formatPhone } from "@psi-opora/api/schemas";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	ChevronDownIcon,
	SlidersHorizontalIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import {
	accountKey,
	type ChannelDraft,
	describePacing,
	findAccount,
	MESSENGER_LABELS,
	matchPreset,
	OFF,
	PACING_PRESETS,
	type Pacing,
	type PresetId,
} from "./delivery-model";

const CUSTOM = "custom";

export function ChannelList({
	channels,
	options,
	onChange,
	startStep = 1,
}: {
	channels: ChannelDraft[];
	options: OutreachOptions;
	onChange: (channels: ChannelDraft[]) => void;
	/** Номер первого включённого канала в общей цепочке (после ботов). */
	startStep?: number;
}) {
	const update = (index: number, patch: Partial<ChannelDraft>) =>
		onChange(channels.map((c, i) => (i === index ? { ...c, ...patch } : c)));
	const move = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= channels.length) return;
		const next = [...channels];
		const [item] = next.splice(index, 1);
		if (item) next.splice(target, 0, item);
		onChange(next);
	};

	// Номер в цепочке — только у включённых каналов, сквозной с ботами.
	let step = startStep - 1;
	return (
		<div className="flex flex-col gap-2">
			{channels.map((draft, index) => {
				const active = draft.enabled && Boolean(findAccount(options, draft));
				if (active) step++;
				return (
					<ChannelCard
						key={draft.channel}
						draft={draft}
						options={options}
						step={active ? step : null}
						canMoveUp={index > 0}
						canMoveDown={index < channels.length - 1}
						onMove={(delta) => move(index, delta)}
						onChange={(patch) => update(index, patch)}
					/>
				);
			})}
		</div>
	);
}

function ChannelCard({
	draft,
	options,
	step,
	canMoveUp,
	canMoveDown,
	onMove,
	onChange,
}: {
	draft: ChannelDraft;
	options: OutreachOptions;
	step: number | null;
	canMoveUp: boolean;
	canMoveDown: boolean;
	onMove: (delta: -1 | 1) => void;
	onChange: (patch: Partial<ChannelDraft>) => void;
}) {
	const [open, setOpen] = useState(false);
	const label = MESSENGER_LABELS[draft.channel];
	const accounts = options[draft.channel];
	const hasConnected = accounts.some((a) => a.status === "connected");
	const preset = matchPreset(draft);

	return (
		<div
			className={cn(
				"rounded-lg border bg-card",
				!draft.enabled && "bg-muted/30",
			)}
		>
			<div className="flex flex-wrap items-center gap-3 p-3">
				<div className="flex flex-col">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-6"
						disabled={!canMoveUp}
						onClick={() => onMove(-1)}
						aria-label={`Поднять ${label} выше`}
					>
						<ArrowUpIcon />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-6"
						disabled={!canMoveDown}
						onClick={() => onMove(1)}
						aria-label={`Опустить ${label} ниже`}
					>
						<ArrowDownIcon />
					</Button>
				</div>
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
						id={`outreach-channel-${draft.channel}`}
						checked={draft.enabled}
						disabled={!hasConnected}
						onCheckedChange={(enabled) => onChange({ enabled })}
					/>
					<Label
						htmlFor={`outreach-channel-${draft.channel}`}
						className="font-medium"
					>
						Личный {label}
					</Label>
				</div>

				{!hasConnected ? (
					<p className="text-sm text-muted-foreground">
						{accounts.length === 0
							? `Нет личного номера ${label} — подключите его в разделе «Каналы».`
							: `Номер ${accounts.map((a) => `${formatPhone(a.phone)} (${a.status})`).join(", ")} сейчас недоступен для отправки.`}
					</p>
				) : (
					<>
						<Select
							value={draft.accountKey}
							disabled={!draft.enabled}
							onValueChange={(value) => onChange({ accountKey: value })}
						>
							<SelectTrigger className="w-full sm:w-52">
								<SelectValue placeholder="Номер" />
							</SelectTrigger>
							<SelectContent>
								{draft.accountKey === OFF && (
									<SelectItem value={OFF}>Выберите номер</SelectItem>
								)}
								{accounts.map((a) => (
									<SelectItem
										key={accountKey(a)}
										value={accountKey(a)}
										disabled={a.status !== "connected"}
									>
										{formatPhone(a.phone)}
										{a.status !== "connected" && ` (${a.status})`}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Select
							value={preset ?? CUSTOM}
							disabled={!draft.enabled}
							onValueChange={(value) => {
								if (value === CUSTOM) {
									setOpen(true);
									return;
								}
								onChange(PACING_PRESETS[value as PresetId].pacing);
							}}
						>
							<SelectTrigger className="w-full sm:w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(PACING_PRESETS).map(([id, p]) => (
									<SelectItem key={id} value={id}>
										{p.label}
									</SelectItem>
								))}
								<SelectItem value={CUSTOM}>Свой режим</SelectItem>
							</SelectContent>
						</Select>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!draft.enabled}
							onClick={() => setOpen((v) => !v)}
							className="ml-auto"
						>
							<SlidersHorizontalIcon />
							Антиспам
							<ChevronDownIcon
								className={cn("transition-transform", open && "rotate-180")}
							/>
						</Button>
					</>
				)}
			</div>

			{draft.enabled && hasConnected && (
				<p className="px-3 pb-3 text-xs text-muted-foreground">
					{describePacing(draft)}
				</p>
			)}

			{open && draft.enabled && hasConnected && (
				<PacingFields
					channel={draft.channel}
					pacing={draft}
					onChange={onChange}
				/>
			)}
		</div>
	);
}

function NumberField({
	id,
	label,
	value,
	onChange,
	min,
	suffix,
}: {
	id: string;
	label: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
	suffix: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id} className="text-xs text-muted-foreground">
				{label}
			</Label>
			<div className="flex items-center gap-2">
				<Input
					id={id}
					type="number"
					min={min}
					value={Number.isFinite(value) ? value : ""}
					onChange={(e) => onChange(Number(e.target.value))}
					className="w-24"
				/>
				<span className="text-sm text-muted-foreground">{suffix}</span>
			</div>
		</div>
	);
}

function PacingFields({
	channel,
	pacing,
	onChange,
}: {
	channel: string;
	pacing: Pacing;
	onChange: (patch: Partial<Pacing>) => void;
}) {
	const id = (field: string) => `outreach-${channel}-${field}`;
	return (
		<div className="grid grid-cols-1 gap-x-8 gap-y-4 border-t p-3 sm:grid-cols-2 lg:grid-cols-[auto_auto_auto_1fr]">
			<NumberField
				id={id("min")}
				label="Пауза от"
				value={pacing.minIntervalSec}
				min={10}
				suffix="с"
				onChange={(minIntervalSec) => onChange({ minIntervalSec })}
			/>
			<NumberField
				id={id("max")}
				label="Пауза до"
				value={pacing.maxIntervalSec}
				min={pacing.minIntervalSec}
				suffix="с"
				onChange={(maxIntervalSec) => onChange({ maxIntervalSec })}
			/>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Switch
						id={id("limit-on")}
						checked={pacing.dailyLimit !== null}
						onCheckedChange={(on) => onChange({ dailyLimit: on ? 100 : null })}
					/>
					<Label htmlFor={id("limit-on")} className="text-xs font-normal">
						Лимит в сутки
					</Label>
				</div>
				{pacing.dailyLimit !== null && (
					<div className="flex items-center gap-2">
						<Input
							type="number"
							min={1}
							value={pacing.dailyLimit}
							onChange={(e) => onChange({ dailyLimit: Number(e.target.value) })}
							className="w-24"
							aria-label="Сообщений в сутки"
						/>
						<span className="text-sm text-muted-foreground">сообщ.</span>
					</div>
				)}
			</div>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Switch
						id={id("batch-on")}
						checked={pacing.batchSize !== null}
						onCheckedChange={(on) => onChange({ batchSize: on ? 20 : null })}
					/>
					<Label htmlFor={id("batch-on")} className="text-xs font-normal">
						Перерывы
					</Label>
				</div>
				{pacing.batchSize !== null && (
					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						каждые
						<Input
							type="number"
							min={1}
							value={pacing.batchSize}
							onChange={(e) => onChange({ batchSize: Number(e.target.value) })}
							className="w-20"
							aria-label="Сообщений до перерыва"
						/>
						на
						<Input
							type="number"
							min={1}
							value={pacing.batchPauseMin}
							onChange={(e) =>
								onChange({ batchPauseMin: Number(e.target.value) })
							}
							className="w-20"
							aria-label="Длительность перерыва, минут"
						/>
						мин
					</div>
				)}
			</div>
			<p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
				Пауза каждый раз выбирается случайно в заданных пределах — ровный ритм
				похож на бота. Лимит считается по номеру за московские сутки с учётом
				других рассылок; попытка, когда номера нет в мессенджере, тоже
				считается.
			</p>
		</div>
	);
}
