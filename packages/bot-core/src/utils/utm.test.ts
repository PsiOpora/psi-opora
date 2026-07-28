import { describe, expect, test } from "bun:test";
import { parseUtmParams } from "./utm";

describe("parseUtmParams", () => {
  test("декодирует percent-encoded код до поиска в справочнике", () => {
    expect(
      parseUtmParams(
        "%D0%A0%D0%9A-%20%D0%9E%D0%9A%D0%A0%20%D0%BF%D0%BE%20%D0%BA%D0%BE%D0%BD%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F%D0%BC",
      ),
    ).toEqual({
      source: "yandex",
      campaign: "РК- ОКР по конверсиям",
    });
  });

  test("декодирует неизвестную кампанию перед сохранением", () => {
    expect(parseUtmParams("%D0%A2%D0%B5%D1%81%D1%82")).toEqual({
      campaign: "Тест",
    });
  });

  test("не падает на некорректном percent-encoding", () => {
    expect(parseUtmParams("campaign%broken")).toEqual({
      campaign: "campaign%broken",
    });
  });
});
