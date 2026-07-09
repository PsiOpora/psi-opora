import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
