import { describe, expect, test } from "bun:test";
import { decode, encode } from "@msgpack/msgpack";
import {
  decodeHeader,
  decodePayload,
  encodeFrame,
  encodeHeader,
  HEADER_LENGTH,
} from "./frame";

describe("encodeHeader/decodeHeader", () => {
  test("round-trip сохраняет все поля заголовка", () => {
    const buf = encodeHeader({
      cmd: 0,
      seq: 42,
      opcode: 17,
      payloadLength: 123,
      compressed: false,
    });
    expect(buf.length).toBe(HEADER_LENGTH);

    const header = decodeHeader(buf);
    expect(header).toMatchObject({
      cmd: 0,
      seq: 42,
      opcode: 17,
      payloadLength: 123,
      compressed: false,
    });
  });

  test("флаг сжатия кодируется отдельным байтом", () => {
    const buf = encodeHeader({
      cmd: 1,
      seq: 1,
      opcode: 6,
      payloadLength: 200,
      compressed: true,
    });
    expect(decodeHeader(buf).compressed).toBe(true);
  });

  test("бросает понятную ошибку на слишком коротком буфере", () => {
    expect(() => decodeHeader(Buffer.alloc(4))).toThrow(/короче/);
  });
});

describe("encodeFrame", () => {
  test("кодирует MessagePack-пейлоад с корректной длиной в заголовке", () => {
    const payload = { phone: "+70000000000", type: "START_AUTH" };
    const frame = encodeFrame({ cmd: 0, seq: 1, opcode: 17 }, payload);

    const header = decodeHeader(frame);
    const body = frame.subarray(HEADER_LENGTH, HEADER_LENGTH + header.payloadLength);
    expect(decode(body)).toEqual(payload);
  });
});

describe("decodePayload", () => {
  test("разбирает обычный MessagePack-пейлоад без префикса", () => {
    const payload = { token: "abc", codeLength: 6 };
    const encoded = Buffer.from(encode(payload));
    expect(decodePayload(encoded)).toEqual(payload);
  });

  test("разбирает пейлоад с эмпирическим 2-байтовым префиксом (koval01)", () => {
    const payload = { token: "abc" };
    const encoded = Buffer.concat([
      Buffer.from([0xf3, 0xa7]),
      Buffer.from(encode(payload)),
    ]);
    expect(decodePayload(encoded)).toEqual(payload);
  });

  test("бросает исходную ошибку, если ни один вариант не разобрался", () => {
    const garbage = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    expect(() => decodePayload(garbage)).toThrow();
  });
});
