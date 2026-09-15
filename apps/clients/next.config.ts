import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Приложение монтирует общий appRouter из @psi-opora/api, куда входит и
	// telegram-personal (mtcute) — те же wasm-грабли, что и в apps/dashboard:
	// webpack бандлит только одну из двух wasm-веток, поэтому пакеты mtcute
	// оставляем внешними и резолвим из node_modules в рантайме.
	serverExternalPackages: ["@mtcute/wasm", "@mtcute/core", "@mtcute/node"],
	// Открывается во фрейме внутри Битрикс24 (домен портала заранее неизвестен),
	// поэтому X-Frame-Options не выставляем — явно разрешаем встройку с
	// *.bitrix24.* через CSP frame-ancestors.
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
