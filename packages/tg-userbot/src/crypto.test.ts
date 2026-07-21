import { describe, expect, test } from "bun:test";

process.env.TG_USERBOT_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");

const { decryptSecret, encryptSecret } = await import("./crypto");

describe("encryptSecret/decryptSecret", () => {
  test("round-trip возвращает исходный текст", () => {
    const plain = "mtcute-session-string-1234567890";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  test("разные вызовы шифрования одного текста дают разный ciphertext (случайный IV)", () => {
    const plain = "same-input";
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  test("повреждённый ciphertext не расшифровывается (проверка authTag)", () => {
    const encrypted = encryptSecret("secret");
    const [iv, tag, ciphertext] = encrypted.split(".");
    const tampered = [iv, tag, `${ciphertext}AA`].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  test("некорректный формат строки бросает понятную ошибку", () => {
    expect(() => decryptSecret("not-a-valid-format")).toThrow(/формат/);
  });
});
