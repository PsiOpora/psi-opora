import type { DealStatus } from "@psi-opora/db/queries";
import { FilterXIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { STATUS_LABEL } from "@/lib/analytics/status-label";

export const ALL = "__all";

interface Option {
	id: string;
	label: string;
}

interface DealsTableFiltersProps {
	searchInput: string;
	onSearchInputChange: (value: string) => void;
	status: string;
	onStatusChange: (value: string) => void;
	category: string;
	onCategoryChange: (value: string) => void;
	categoryOptions: Option[];
	stage: string;
	onStageChange: (value: string) => void;
	stageOptions: Option[];
	source: string;
	onSourceChange: (value: string) => void;
	sourceOptions: Option[];
	hasFilters: boolean;
	onReset: () => void;
	isFetching: boolean;
	isLoading: boolean;
}

export function DealsTableFilters({
	searchInput,
	onSearchInputChange,
	status,
	onStatusChange,
	category,
	onCategoryChange,
	categoryOptions,
	stage,
	onStageChange,
	stageOptions,
	source,
	onSourceChange,
	sourceOptions,
	hasFilters,
	onReset,
	isFetching,
	isLoading,
}: DealsTableFiltersProps) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<div className="relative min-w-56 flex-1">
				<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					aria-label="Поиск сделок"
					placeholder="Название, UTM, стадия или источник…"
					value={searchInput}
					onChange={(event) => onSearchInputChange(event.target.value)}
					className="pl-8"
				/>
			</div>
			<Select value={status} onValueChange={onStatusChange}>
				<SelectTrigger aria-label="Фильтр по статусу" className="min-w-36">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectItem value={ALL}>Все статусы</SelectItem>
						{(
							Object.entries(STATUS_LABEL) as Array<
								[DealStatus, (typeof STATUS_LABEL)[DealStatus]]
							>
						).map(([value, info]) => (
							<SelectItem key={value} value={value}>
								{info.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<Select value={category} onValueChange={onCategoryChange}>
				<SelectTrigger aria-label="Фильтр по воронке" className="min-w-40">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectItem value={ALL}>Все воронки</SelectItem>
						{categoryOptions.map((option) => (
							<SelectItem key={option.id} value={option.id}>
								{option.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<Select value={stage} onValueChange={onStageChange}>
				<SelectTrigger aria-label="Фильтр по стадии" className="min-w-40">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectItem value={ALL}>Все стадии</SelectItem>
						{stageOptions.map((option) => (
							<SelectItem key={option.id} value={option.id}>
								{option.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<Select value={source} onValueChange={onSourceChange}>
				<SelectTrigger aria-label="Фильтр по источнику" className="min-w-40">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectItem value={ALL}>Все источники</SelectItem>
						{sourceOptions.map((option) => (
							<SelectItem key={option.id} value={option.id}>
								{option.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			{hasFilters && (
				<Button variant="ghost" size="sm" onClick={onReset}>
					<FilterXIcon data-icon="inline-start" />
					Сбросить
				</Button>
			)}
			{isFetching && !isLoading && (
				<Loader2Icon className="size-4 animate-spin text-muted-foreground" />
			)}
		</div>
	);
}
