import type { Metadata } from "next";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { BitrixFrameProvider } from "@/components/bitrix/frame-provider";
import { QueryProvider } from "@/components/providers/query-provider";

export const metadata: Metadata = {
	title: "Пси-Опора — CRM аналитика",
	description:
		"Аналитика CRM и маркетинга для Битрикс24: UTM-отчёты, воронка, источники.",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			lang="ru"
			suppressHydrationWarning
			className={cn("font-sans", GeistSans.variable)}
		>
			<body>
				<QueryProvider>
					<TooltipProvider>
						<BitrixFrameProvider>{children}</BitrixFrameProvider>
						<Toaster position="top-right" richColors />
					</TooltipProvider>
				</QueryProvider>
			</body>
		</html>
	);
}
