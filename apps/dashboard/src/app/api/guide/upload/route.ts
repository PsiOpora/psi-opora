import { handleGuideUpload } from "@psi-opora/api";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getBitrixApi } from "@/lib/bitrix/session";

export const dynamic = "force-dynamic";

/**
 * Загрузка PDF-гайда через XHR (не server action), чтобы клиент мог
 * показать прогресс отправки по событию xhr.upload.onprogress.
 */
export async function POST(request: Request): Promise<Response> {
  const api = await getBitrixApi();
  if (!api) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("guide");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Выберите PDF-файл" }, { status: 400 });
  }
  const title = String(formData.get("title") ?? "").trim();

  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "https://psi-opora-dashboard.orixon.ru";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";

  try {
    const result = await handleGuideUpload(file, `${proto}://${host}`, title);
    revalidatePath("/settings/bot");
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
