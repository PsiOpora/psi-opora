import type { Metadata } from "next";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { BitrixFrameProvider } from "@/components/bitrix/frame-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
	title: "Пси-Опора — Клиенты",
	description:
		"Единый инбокс переписки с клиентами: Telegram, MAX, личный номер.",
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
