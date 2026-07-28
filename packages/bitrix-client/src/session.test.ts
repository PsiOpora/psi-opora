import { describe, expect, test } from "bun:test";
import {
  createBitrixSessionToken,
  createMessageMediaSignature,
  verifyBitrixSessionToken,
  verifyMessageMediaSignature,
} from "./session";

const SECRET = "test-secret-that-is-not-used-outside-this-test";
const NOW = 1_800_000_000;

describe("Bitrix signed session", () => {
  test("accepts an intact, unexpired token for the expected app", () => {
    const token = createBitrixSessionToken(
      {
        app: "clients",
        memberId: "member-1",
        userId: "42",
        domain: "portal.bitrix24.ru",
      },
      SECRET,
      NOW,
    );

    expect(
      verifyBitrixSessionToken(token, "clients", SECRET, NOW),
    ).toMatchObject({
      app: "clients",
      memberId: "member-1",
      userId: "42",
    });
  });

  test("rejects tampering, another app and expiration", () => {
    const token = createBitrixSessionToken(
      {
        app: "clients",
        memberId: "member-1",
        userId: "42",
        domain: "portal.bitrix24.ru",
      },
      SECRET,
      NOW,
    );
    const tampered = `${token.slice(0, -1)}x`;

    expect(
      verifyBitrixSessionToken(tampered, "clients", SECRET, NOW),
    ).toBeNull();
    expect(
      verifyBitrixSessionToken(token, "dashboard", SECRET, NOW),
    ).toBeNull();
    expect(
      verifyBitrixSessionToken(token, "clients", SECRET, NOW + 8 * 60 * 60),
    ).toBeNull();
  });
});

describe("message media signature", () => {
  test("is bound to message id and expires", () => {
    const signed = createMessageMediaSignature("message-1", SECRET, NOW);

    expect(
      verifyMessageMediaSignature(
        "message-1",
        signed.expires,
        signed.signature,
        SECRET,
        NOW,
      ),
    ).toBe(true);
    expect(
      verifyMessageMediaSignature(
        "message-2",
        signed.expires,
        signed.signature,
        SECRET,
        NOW,
      ),
    ).toBe(false);
    expect(
      verifyMessageMediaSignature(
        "message-1",
        signed.expires,
        signed.signature,
        SECRET,
        signed.expires,
      ),
    ).toBe(false);
  });
});
