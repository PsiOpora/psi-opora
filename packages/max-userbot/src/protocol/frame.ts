import { decode, encode } from "@msgpack/msgpack";

/**
 * Фрейминг протокола MAX/OneMe: 10-байтовый заголовок + MessagePack-пейлоад.
 * Раскладка байтов сведена из двух независимых разборов (koval01/analysis.md
 * и PronikFire/Max-API-Guide) — оба описывают один и тот же 10-байтовый
 * заголовок, но по-разному режут последние 4 байта (koval01: единое
 * 4-байтовое payload_len, где старший байт — флаг LZ4-сжатия; PronikFire:
 * отдельный байт `cof` + 3-байтовая длина) — это одна и та же раскладка байт
 * в байт, ниже используется вариант PronikFire как более явный.
 */
export const HEADER_LENGTH = 10;

/** cmd: 0 — запрос (клиент→сервер), 1 — ответ, 3 — ошибка. */
export type FrameCommand = 0 | 1 | 3;

export interface FrameHeader {
  version: number;
  cmd: FrameCommand;
  seq: number;
  opcode: number;
  /** LZ4-сжатие пейлоада — по разбору применяется только при payload > 32
   * байт; для логина не ожидается, но флаг всё равно разбираем. */
  compressed: boolean;
  payloadLength: number;
}

/** Версия протокола — "допустимый диапазон 5–10" по разбору koval01, берём
 * верхнюю границу диапазона. */
const PROTOCOL_VERSION = 10;

export function encodeHeader(header: {
  cmd: FrameCommand;
  seq: number;
  opcode: number;
  payloadLength: number;
  compressed?: boolean;
}): Buffer {
  const buf = Buffer.alloc(HEADER_LENGTH);
  buf.writeUInt8(PROTOCOL_VERSION, 0);
  buf.writeUInt8(header.cmd, 1);
  buf.writeUInt16BE(header.seq, 2);
  buf.writeUInt16BE(header.opcode, 4);
  buf.writeUInt8(header.compressed ? 1 : 0, 6);
  buf.writeUIntBE(header.payloadLength, 7, 3);
  return buf;
}

export function decodeHeader(buf: Buffer): FrameHeader {
  if (buf.length < HEADER_LENGTH) {
    throw new Error(`Заголовок MAX короче ${HEADER_LENGTH} байт`);
  }
  return {
    version: buf.readUInt8(0),
    cmd: buf.readUInt8(1) as FrameCommand,
    seq: buf.readUInt16BE(2),
    opcode: buf.readUInt16BE(4),
    compressed: buf.readUInt8(6) !== 0,
    payloadLength: buf.readUIntBE(7, 3),
  };
}

export function encodeFrame(
  header: { cmd: FrameCommand; seq: number; opcode: number },
  payload: Record<string, unknown>,
): Buffer {
  const body = Buffer.from(encode(payload));
  const headerBuf = encodeHeader({ ...header, payloadLength: body.length });
  return Buffer.concat([headerBuf, body]);
}

/**
 * По разбору koval01 часть ответов несёт 2-байтовый префикс перед самой
 * MessagePack-мапой (например `0xf0 0xa0` у ответа на SESSION_INIT, `0xf3
 * 0xa7` у ответа на AUTH_REQUEST) — судя по всему, артефакт конкретной
 * версии клиента/сервера, разобранной автором гиста, а не задокументированное
 * поведение. Пробуем декодировать пейлоад как есть; если MessagePack-парсер
 * падает — пробуем ещё раз, отступив 2 байта. Если во время живой проверки
 * протокола выяснится другое смещение или что префикса нет вовсе — менять
 * только эту функцию, вызывающий код (client.ts) о префиксе не знает.
 */
export function decodePayload(payload: Uint8Array): Record<string, unknown> {
  try {
    return decode(payload) as Record<string, unknown>;
  } catch (err) {
    if (payload.length > 2) {
      try {
        return decode(payload.subarray(2)) as Record<string, unknown>;
      } catch {
        // ниже пробрасываем исходную ошибку — она информативнее для отладки
      }
    }
    throw err;
  }
}
