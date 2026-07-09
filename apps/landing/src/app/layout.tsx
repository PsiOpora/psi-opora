import type { Metadata } from "next";
import { Spectral, Inter } from "next/font/google";
import "./globals.css";

const spectral = Spectral({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-spectral",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Опора — помощь родителям подростков с анорексией",
  description:
    "Когда подросток отказывается от помощи, путь к его выздоровлению начинается с родителя. Бесплатная диагностика для родителей — онлайн по всей России и очно в Нижнем Новгороде.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${spectral.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
