import { MemoryStorage, SentCode, tl } from "@mtcute/core";
import { TelegramClient } from "@mtcute/node";

export interface TelegramApiCredentials {
	apiId: number;
	apiHash: string;
}

/**
 * Логин личного аккаунта Telegram (mtcute) идёт в несколько шагов через
 * отдельные HTTP-запросы дашборда (без держания сокета между ними) —
 * каждый шаг создаёт свежий клиент и восстанавливает состояние через
 * exportSession()/importSession() неавторизованной сессии, а не держит
 * один и тот же процесс/соединение живым между шагами.
 *
 * apiId/apiHash приходят от вызывающего (введены администратором в
 * настройках коннектора — my.telegram.org/apps), а не из env: у каждого
 * подключаемого номера может быть своё приложение.
 */
function createClient(credentials: TelegramApiCredentials): TelegramClient {
	return new TelegramClient({
		apiId: credentials.apiId,
		apiHash: credentials.apiHash,
		storage: new MemoryStorage(),
	});
}

/**
 * Ошибку destroy() в `finally` не пробрасываем — иначе она заменит собой
 * более информативную ошибку из основного блока (например PHONE_CODE_INVALID),
 * если сам разрыв соединения тоже почему-то упал.
 */
async function destroySafely(tg: TelegramClient): Promise<void> {
	try {
		await tg.destroy();
	} catch (err) {
		console.error(
			`[tg-userbot] ошибка при закрытии клиента: ${(err as Error).message}`,
		);
	}
}

export interface SendLoginCodeResult {
	pendingSession: string;
	phoneCodeHash: string;
}

export async function sendLoginCode(
	phone: string,
	credentials: TelegramApiCredentials,
): Promise<SendLoginCodeResult> {
	const tg = createClient(credentials);
	try {
		const sentCode = await tg.sendCode({ phone });
		if (!(sentCode instanceof SentCode)) {
			// sendCode вернул User — аккаунт уже авторизован в этой (свежей)
			// сессии, такого быть не должно для MemoryStorage с нуля.
			throw new Error("Telegram сообщил, что аккаунт уже авторизован");
		}
		const pendingSession = await tg.exportSession();
		return { pendingSession, phoneCodeHash: sentCode.phoneCodeHash };
	} finally {
		await destroySafely(tg);
	}
}

export type ConfirmLoginResult =
	| { status: "connected"; session: string }
	| { status: "password_required"; pendingSession: string };

export async function confirmLoginCode(
	params: {
		pendingSession: string;
		phone: string;
		phoneCodeHash: string;
		code: string;
	},
	credentials: TelegramApiCredentials,
): Promise<ConfirmLoginResult> {
	const tg = createClient(credentials);
	try {
		await tg.importSession(params.pendingSession);
		try {
			await tg.signIn({
				phone: params.phone,
				phoneCodeHash: params.phoneCodeHash,
				phoneCode: params.code,
			});
			return { status: "connected", session: await tg.exportSession() };
		} catch (err) {
			if (tl.RpcError.is(err, "SESSION_PASSWORD_NEEDED")) {
				return {
					status: "password_required",
					pendingSession: await tg.exportSession(),
				};
			}
			throw err;
		}
	} finally {
		await destroySafely(tg);
	}
}

export async function confirmLoginPassword(
	params: {
		pendingSession: string;
		password: string;
	},
	credentials: TelegramApiCredentials,
): Promise<{ status: "connected"; session: string }> {
	const tg = createClient(credentials);
	try {
		await tg.importSession(params.pendingSession);
		await tg.checkPassword(params.password);
		return { status: "connected", session: await tg.exportSession() };
	} finally {
		await destroySafely(tg);
	}
}
