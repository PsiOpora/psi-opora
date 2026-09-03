import { connect, type TLSSocket } from "node:tls";
import {
	decodeHeader,
	decodePayload,
	encodeFrame,
	type FrameHeader,
	HEADER_LENGTH,
} from "./frame";
import { decompressLz4Block } from "./lz4";

/** По разбору koval01 — raw TLS TCP, а не WebSocket (расхождение с описанием
 * maxcalls, см. план). Если живая проверка покажет обратное, транспорт можно
 * заменить (например на `ws`), не трогая фрейминг/RPC-логику ниже — она
 * оперирует уже разобранными Buffer'ами, а не сокетом напрямую. */
export const MAX_API_HOST = "api.oneme.ru";
export const MAX_API_PORT = 443;

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface MaxProtocolClientOptions {
	host?: string;
	port?: number;
	/** Входящие пуш-сообщения сервера (cmd=0 без ожидающего запроса с таким же
	 * seq) — понадобится Фазе 2 для приёма сообщений в реальном времени. */
	onPush?: (opcode: number, payload: Record<string, unknown>) => void;
	/** Неожиданный обрыв постоянного соединения. Не вызывается при close(). */
	onClose?: (error: Error) => void;
	requestTimeoutMs?: number;
}

interface PendingRequest {
	opcode: number;
	resolve: (payload: Record<string, unknown>) => void;
	reject: (err: Error) => void;
}

export function nextFrameSequence(
	current: number,
	isPending: (seq: number) => boolean = () => false,
): number {
	let candidate = current;
	for (let attempts = 0; attempts < 65_535; attempts++) {
		candidate = candidate >= 65_535 ? 1 : candidate + 1;
		if (!isPending(candidate)) return candidate;
	}
	throw new Error("Все sequence-номера MAX заняты ожидающими запросами");
}

/**
 * Низкоуровневый RPC-клиент протокола MAX/OneMe поверх TLS-сокета — держит
 * очередь ожидающих запросов по `seq` и разбирает входящий поток на кадры
 * (см. src/protocol/frame.ts). Не знает ничего про логин/пользовательские
 * сценарии — это делает src/login.ts.
 */
export class MaxProtocolClient {
	private socket: TLSSocket | null = null;
	private seq = 0;
	private recvBuffer = Buffer.alloc(0);
	private readonly pending = new Map<number, PendingRequest>();
	private readonly requestTimeoutMs: number;
	private closing = false;
	private fatalErrorHandled = false;

	constructor(private readonly options: MaxProtocolClientOptions = {}) {
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	}

	async connect(): Promise<void> {
		this.closing = false;
		this.fatalErrorHandled = false;
		const host = this.options.host ?? MAX_API_HOST;
		const port = this.options.port ?? MAX_API_PORT;

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const socket = connect({ host, port }, () => {
				settled = true;
				resolve();
			});
			socket.once("error", (err) => {
				if (!settled) reject(err);
			});
			socket.on("data", (chunk: Buffer) => this.onData(chunk));
			socket.on("error", (err) => this.onFatalError(err));
			socket.on("close", () =>
				this.onFatalError(new Error("Соединение с MAX закрыто сервером")),
			);
			this.socket = socket;
		});
	}

	close(): void {
		this.closing = true;
		this.socket?.destroy();
		this.socket = null;
	}

	/** Отправляет запрос по opcode и ждёт ответ с тем же seq (RPC поверх TCP). */
	async request(
		opcode: number,
		payload: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const socket = this.socket;
		if (!socket)
			throw new Error("Клиент MAX не подключён — вызовите connect()");

		const seq = nextFrameSequence(this.seq, (value) => this.pending.has(value));
		this.seq = seq;
		const frame = encodeFrame({ cmd: 0, seq, opcode }, payload);

		return new Promise<Record<string, unknown>>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(seq);
				reject(
					new Error(
						`MAX не ответил на opcode ${opcode} за ${this.requestTimeoutMs}мс`,
					),
				);
			}, this.requestTimeoutMs);

			this.pending.set(seq, {
				opcode,
				resolve: (value) => {
					clearTimeout(timeout);
					resolve(value);
				},
				reject: (err) => {
					clearTimeout(timeout);
					reject(err);
				},
			});

			socket.write(frame, (err) => {
				if (err) {
					clearTimeout(timeout);
					this.pending.delete(seq);
					reject(err);
				}
			});
		});
	}

	private onData(chunk: Buffer): void {
		this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);

		for (;;) {
			if (this.recvBuffer.length < HEADER_LENGTH) return;

			let header: FrameHeader;
			try {
				header = decodeHeader(this.recvBuffer);
			} catch (err) {
				this.onFatalError(err as Error);
				return;
			}

			const frameLength = HEADER_LENGTH + header.payloadLength;
			if (this.recvBuffer.length < frameLength) return;

			const payloadBuf = this.recvBuffer.subarray(HEADER_LENGTH, frameLength);
			this.recvBuffer = this.recvBuffer.subarray(frameLength);
			this.handleFrame(header, payloadBuf);
		}
	}

	private handleFrame(header: FrameHeader, payloadBuf: Buffer): void {
		let payload: Record<string, unknown>;
		try {
			payload = decodePayload(
				header.compressed ? decompressLz4Block(payloadBuf) : payloadBuf,
			);
		} catch (err) {
			console.error(
				`[max-userbot] не удалось разобрать MessagePack-пейлоад (opcode ${header.opcode}): ${(err as Error).message}`,
			);
			this.pending.get(header.seq)?.reject(err as Error);
			this.pending.delete(header.seq);
			return;
		}

		const pending = this.pending.get(header.seq);
		if (pending && header.cmd !== 0) {
			this.pending.delete(header.seq);
			if (header.cmd === 3) {
				console.error(
					`[max-userbot] MAX вернул ошибку на opcode ${pending.opcode} (seq ${header.seq}): ${JSON.stringify(payload)}`,
				);
				pending.reject(
					new Error(
						`MAX вернул ошибку на opcode ${pending.opcode}: ${JSON.stringify(payload)}`,
					),
				);
			} else {
				pending.resolve(payload);
			}
			return;
		}

		this.options.onPush?.(header.opcode, payload);
	}

	private onFatalError(err: Error): void {
		if (this.fatalErrorHandled) return;
		this.fatalErrorHandled = true;
		if (!this.closing) {
			console.error(`[max-userbot] соединение с MAX прервано: ${err.message}`);
		}
		const socket = this.socket;
		this.socket = null;
		if (socket && !socket.destroyed) socket.destroy();
		for (const [seq, pending] of this.pending) {
			pending.reject(err);
			this.pending.delete(seq);
		}
		if (!this.closing) this.options.onClose?.(err);
	}
}
