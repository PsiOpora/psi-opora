import {
	handleEmailImageUpload,
	publicOriginFromHeaders,
} from "@psi-opora/api";
import {
	DASHBOARD_SESSION_COOKIE,
	verifyBitrixSessionToken,
} from "@psi-opora/bitrix-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Загрузка картинки для email-шаблона (multipart, поле "image"). Доступна
 * только из проверенного встроенного приложения Битрикс24 — как процедуры
 * bitrixProcedure в oRPC.
 */
export async function POST(request: Request): Promise<Response> {
	const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
	if (!verifyBitrixSessionToken(token, "dashboard")) {
		return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
	}

	const origin = publicOriginFromHeaders(request.headers);
	if (!origin) {
		return NextResponse.json(
			{ error: "Не удалось определить адрес дашборда" },
			{ status: 400 },
		);
	}

	let file: FormDataEntryValue | null;
	try {
		file = (await request.formData()).get("image");
	} catch {
		return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
	}
	if (!(file instanceof File)) {
		return NextResponse.json({ error: "Выберите картинку" }, { status: 400 });
	}

	try {
		const result = await handleEmailImageUpload(file, origin);
		return NextResponse.json({ ok: true, ...result });
	} catch (err) {
		return NextResponse.json(
			{ error: (err as Error).message },
			{ status: 400 },
		);
	}
}
