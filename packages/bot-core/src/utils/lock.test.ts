import { describe, expect, test } from "bun:test";
import type { RedisClient } from "../storage/redis";
import { withUserLock } from "./lock";

/** Мини-имитация Redis: только то подмножество set/get/eval,
 * которое использует withUserLock (release/renew идут через eval —
 * compare-and-delete / compare-and-expire по токену). */
function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    async set(
      key: string,
      value: string,
      opts?: { nx?: boolean; px?: number },
    ) {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async eval(script: string, keys: string[], args: (string | number)[]) {
      const key = keys[0] ?? "";
      const token = args[0];
      if (store.get(key) !== token) return 0;
      // Единственный скрипт, который действительно меняет стор в фейке, —
      // снятие лока (del); продление (pexpire) TTL здесь не моделируем, для
      // теста достаточно, что оно не ошибается и не трогает значение.
      if (script.includes("del")) store.delete(key);
      return 1;
    },
  } as unknown as RedisClient;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("withUserLock", () => {
  test("без redis выполняет fn напрямую", async () => {
    const result = await withUserLock(undefined, "user:1", async () => 42);
    expect(result).toBe(42);
  });

  test("сериализует два вызова с одним и тем же ключом", async () => {
    const redis = createFakeRedis();
    const order: string[] = [];

    const first = withUserLock(redis, "user:1", async () => {
      order.push("first:start");
      await sleep(80);
      order.push("first:end");
    });
    // Даём первому вызову гарантированно захватить лок раньше второго.
    await sleep(10);
    const second = withUserLock(redis, "user:1", async () => {
      order.push("second:start");
    });

    await Promise.all([first, second]);

    // Второй вызов не мог начаться, пока первый не отпустил лок.
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("разные ключи не блокируют друг друга", async () => {
    const redis = createFakeRedis();
    const order: string[] = [];

    const a = withUserLock(redis, "user:1", async () => {
      order.push("a:start");
      await sleep(80);
      order.push("a:end");
    });
    await sleep(10);
    const b = withUserLock(redis, "user:2", async () => {
      order.push("b:start");
    });

    await Promise.all([a, b]);

    // Разные пользователи — b успевает выполниться, пока a ещё держит свой лок.
    expect(order.indexOf("b:start")).toBeLessThan(order.indexOf("a:end"));
  });
});
