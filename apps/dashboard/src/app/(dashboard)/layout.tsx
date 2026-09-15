import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { HeaderActions } from "@/components/dashboard/header-actions";
import { Suspense } from "react";

export default function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset>
				<header className="flex h-14 items-center justify-between gap-2 border-b px-4">
					<div className="flex items-center gap-2">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-4" />
						<span className="text-sm text-muted-foreground">
							Аналитика CRM и маркетинга
						</span>
					</div>
					<Suspense
						fallback={
							<div className="h-8 w-48 animate-pulse rounded bg-muted" />
						}
					>
						<HeaderActions />
					</Suspense>
				</header>
				<main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
