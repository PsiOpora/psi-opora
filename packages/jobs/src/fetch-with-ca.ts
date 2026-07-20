import https from "node:https";
import type { URL } from "node:url";

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

/**
 * node:https-запрос, который доверяет переданному CA-bundle.
 *
 * Нужен для вызовов к API, чей сертификат подписан CA, не входящим в
 * стандартное хранилище Node.js / Vercel (например, сертификаты Минцифры).
 */
export function fetchWithCa(
  url: URL,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
  ca: string | Buffer,
): Promise<FetchResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        ca,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) headers.append(key, v);
            } else {
              headers.set(key, value);
            }
          }
          resolve({
            ok:
              res.statusCode !== undefined &&
              res.statusCode >= 200 &&
              res.statusCode !== undefined &&
              res.statusCode >= 200 &&
              res.statusCode < 300,
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? "",
            headers,
            text: async () => text,
            json: async () => {
              if (!text) return null;
              return JSON.parse(text) as unknown;
            },
          });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
