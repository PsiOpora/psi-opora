import { describe, expect, test } from "bun:test";
import { normalizeAvatarUrl } from "./bot-users";

describe("normalizeAvatarUrl", () => {
  test("removes the domain from an absolute URL", () => {
    expect(
      normalizeAvatarUrl(
        "https://dashboard.example/api/avatar-file/telegram/123?size=large",
      ),
    ).toBe("/api/avatar-file/telegram/123?size=large");
  });

  test("keeps a relative URL unchanged", () => {
    expect(normalizeAvatarUrl("/api/avatar-file/max/456")).toBe(
      "/api/avatar-file/max/456",
    );
  });
});
