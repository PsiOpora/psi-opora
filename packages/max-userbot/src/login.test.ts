import { describe, expect, test } from "bun:test";
import { userAgentPayload } from "./login";

describe("userAgentPayload", () => {
  test("представляется актуальной поддерживаемой Android-сборкой MAX", () => {
    expect(userAgentPayload()).toMatchObject({
      appVersion: "26.25.0",
      buildNumber: 6790,
      deviceType: "ANDROID",
    });
  });
});
