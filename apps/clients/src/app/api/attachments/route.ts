import { uploadOutboundAttachment } from "@psi-opora/api";
import {
	CLIENTS_SESSION_COOKIE,
	verifyBitrixSessionToken,
} from "@psi-opora/bitrix-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Загрузка вложения (фото/файл) перед отправкой клиенту из инбокса
 * «Клиенты» — обычный API-роут с FormData, а не oRPC (см. apps/dashboard/
 * api/guide/upload — тот же приём для бинарных тел). Файл уходит в S3 сразу
 * по выбору в composer'е, а не вместе с текстом сообщения: так превью в
 * composer'е и прогресс загрузки не завязаны на отправку.
 */
export async function POST(request: Request): Promise<Response> {
	const token = (await cookies()).get(CLIENTS_SESSION_COOKIE)?.value;
	const session = verifyBitrixSessionToken(token, "clients");
	if (!session) {
		return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
	}

	const formData = await request.formData();
	const file = formData.get("file");
	if (!(file instanceof File)) {
		return NextResponse.json({ error: "Выберите файл" }, { status: 400 });
	}

	try {
		const uploaded = await uploadOutboundAttachment(file);
		return NextResponse.json({ ok: true, ...uploaded });
	} catch (err) {
		return NextResponse.json(
			{ error: (err as Error).message },
			{ status: 400 },
		);
	}
}
