import { uploadOutboundAttachment } from "@psi-opora/api";
import { NextResponse } from "next/server";
import { getBitrixApi } from "@/lib/bitrix/session";

export const dynamic = "force-dynamic";

/**
 * Загрузка вложения (фото/файл/голосовое) перед отправкой клиенту из вкладки
 * «Мессенджер» в карточке CRM — обычный API-роут с FormData, как и загрузка
 * гайда (api/guide/upload). Файл уходит в S3 сразу после выбора в поле ввода,
 * а не вместе с текстом: так превью и прогресс не завязаны на отправку.
 * Тот же приём и тот же сервис, что в apps/clients/api/attachments.
 */
export async function POST(request: Request): Promise<Response> {
	const api = await getBitrixApi();
	if (!api) {
		return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
	}

	const formData = await request.formData();
	const file = formData.get("file");
	if (!(file instanceof File)) {
		return NextResponse.json({ error: "Выберите файл" }, { status: 400 });
	}

	try {
		const uploaded = await uploadOutboundAttachment(file, request.signal);
		return NextResponse.json({ ok: true, ...uploaded });
	} catch (err) {
		return NextResponse.json(
			{ error: (err as Error).message },
			{ status: 400 },
		);
	}
}
