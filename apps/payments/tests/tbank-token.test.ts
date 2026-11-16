import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { computeTbankToken, verifyTbankToken } from "../src/tbank-token";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

test("Token: значения отсортированных по ключу пар + Password, без Token/Data/Receipt", () => {
	const params = {
		TerminalKey: "TK",
		OrderId: "ord-1",
		Success: true,
		Status: "CONFIRMED",
		PaymentId: 123,
		Amount: 150000,
		Data: { a: "b" },
		Receipt: { x: 1 },
		Token: "ignored",
		Pan: null,
	};
	// Ключи по алфавиту: Amount, OrderId, Password, PaymentId, Status, Success, TerminalKey
	expect(computeTbankToken(params, "pw")).toBe(
		sha("150000ord-1pw123CONFIRMEDtrueTK"),
	);
});

test("verifyTbankToken принимает верную подпись и отвергает неверную", () => {
	const params = { TerminalKey: "TK", OrderId: "1", Amount: 100 };
	const Token = computeTbankToken(params, "pw");
	expect(verifyTbankToken({ ...params, Token }, "pw")).toBe(true);
	expect(verifyTbankToken({ ...params, Token }, "other")).toBe(false);
	expect(verifyTbankToken({ ...params, Amount: 101, Token }, "pw")).toBe(false);
	expect(verifyTbankToken(params, "pw")).toBe(false);
});
