"use client";

import { Check, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function splitGroupName(group: string) {
	const match = group.match(/^(\d+)\.\s*(.*)$/);
	return match
		? { number: match[1], title: match[2] }
		: { number: "", title: group };
}

export function GroupTabs({
	groups,
	changedCounts,
	children,
}: {
	groups: string[];
	changedCounts: Record<string, number>;
	children: React.ReactNode[];
}) {
	const [active, setActive] = useState(groups[0]);

	useEffect(() => {
		if (!active && groups[0]) setActive(groups[0]);
	}, [active, groups]);

	return (
		<div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
			<nav
				aria-label="Этапы сценария"
				className="flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible lg:pb-0"
			>
				<p className="hidden px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:block">
					Этапы сценария
				</p>
				{groups.map((group) => {
					const { number, title } = splitGroupName(group);
					const count = changedCounts[group] ?? 0;
					const selected = active === group;

					return (
						<Button
							key={group}
							type="button"
							variant={selected ? "secondary" : "ghost"}
							onClick={() => setActive(group)}
							className="h-auto min-w-56 justify-start px-3 py-2.5 text-left lg:min-w-0"
							aria-current={selected ? "step" : undefined}
						>
							<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-xs font-semibold shadow-sm">
								{number}
							</span>
							<span className="min-w-0 flex-1 truncate">{title}</span>
							{count > 0 ? (
								<Badge variant="secondary" className="ml-auto">
									<Check data-icon="inline-start" />
									{count}
								</Badge>
							) : (
								<ChevronRight data-icon="inline-end" className="ml-auto" />
							)}
						</Button>
					);
				})}
			</nav>

			<div className="min-w-0">
				{groups.map((group, index) => (
					<div key={group} className={cn(active !== group && "hidden")}>
						{children[index]}
					</div>
				))}
			</div>
		</div>
	);
}
