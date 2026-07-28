import { type NextRequest, NextResponse } from "next/server";

const BLOCKED_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Психологический центр «Опора»</title>
  </head>
  <body>
    <main>
      <h1>Приложение доступно только внутри Битрикс24</h1>
      <p>Откройте раздел «Клиенты» на вашем портале Битрикс24.</p>
    </main>
  </body>
</html>`;

export function proxy(request: NextRequest) {
  if (
    process.env.NODE_ENV === "production" &&
    request.headers.get("sec-fetch-dest") === "document"
  ) {
    return new NextResponse(BLOCKED_HTML, {
      status: 403,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
