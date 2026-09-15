import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		serverActions: {
			// Загрузка PDF-гайда через server action (по умолчанию лимит 1 МБ)
			bodySizeLimit: "12mb",
		},
	},
	// mtcute (личные Telegram-аккаунты) грузит crypto-примитивы из .wasm через
	// `new URL('./mtcute-simd.wasm', import.meta.url)` — webpack бандлит только
	// одну из двух wasm-веток (не-SIMD), из-за чего в проде падает
	// "Cannot find module '@mtcute/wasm/mtcute-simd.wasm'". Исключаем пакет из
	// серверного бандла, чтобы он резолвился как обычный node_modules при рантайме.
	serverExternalPackages: ["@mtcute/wasm", "@mtcute/core", "@mtcute/node"],
	// Приложение открывается во фрейме внутри Битрикс24 (домен портала заранее
	// неизвестен), поэтому X-Frame-Options не выставляем — вместо запрета
	// явно разрешаем встройку с *.bitrix24.* через CSP frame-ancestors.
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{
						key: "Content-Security-Policy",
						value:
							"frame-ancestors 'self' https://*.bitrix24.ru https://*.bitrix24.com https://*.bitrix24.by https://*.bitrix24.kz https://*.bitrix24.de https://*.bitrix24.eu;",
					},
				],
			},
		];
	},
};

export default nextConfig;
