import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bitrix24 Webhook",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
