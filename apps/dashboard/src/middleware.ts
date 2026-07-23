import { NextResponse, type NextRequest } from "next/server";

// Приложение — локальный апп Битрикс24, работать должно только встроенным во
// фрейм портала. Браузер помечает такую навигацию заголовком
// `Sec-Fetch-Dest: iframe`, а прямой заход по ссылке/закладке — `document`.
// XHR/fetch-запросы клиентского кода (Sec-Fetch-Dest: empty) сюда не попадают,
// так как matcher ниже пропускает только навигации по HTML-страницам.
const BLOCKED_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Психологический центр «Опора»</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
        background: #f8f9fb;
        color: #1f2937;
      }
      .box { max-width: 28rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.15rem; margin: 0 0 0.5rem; }
      p { margin: 0; color: #6b7280; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Приложение доступно только внутри Битрикс24</h1>
      <p>Откройте его из соответствующего раздела вашего портала Битрикс24.</p>
    </div>
  </body>
</html>`;

export function middleware(request: NextRequest) {
  if (request.headers.get("sec-fetch-dest") === "document") {
    return new NextResponse(BLOCKED_HTML, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
