import { env } from "@psi-opora/config";
import Redis from "ioredis";

export interface RedisSetOptions {
  ex?: number;
  px?: number;
  nx?: boolean;
}

export interface RedisClient {
  get<T>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    options?: RedisSetOptions,
  ): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  rpush(key: string, ...values: unknown[]): Promise<number>;
  lpop<T>(key: string): Promise<T | null>;
  sadd(key: string, ...members: unknown[]): Promise<number>;
  srem(key: string, ...members: unknown[]): Promise<number>;
  smembers<T = string>(key: string): Promise<T[]>;
  hgetall<T extends Record<string, unknown>>(key: string): Promise<T | null>;
  hset(key: string, fields: Record<string, unknown>): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  zadd(key: string, entry: { score: number; member: unknown }): Promise<number>;
  zrem(key: string, ...members: unknown[]): Promise<number>;
  zrange<T>(
    key: string,
    start: number,
    stop: number,
    options?: { byScore?: boolean },
  ): Promise<T>;
  eval(script: string, keys: string[], args: unknown[]): Promise<unknown>;
}

export interface StorageAdapter<T> {
  read(key: string): T | undefined | Promise<T | undefined>;
  write(key: string, value: T): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

function encode(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError("Redis не поддерживает значение undefined");
  }
  return encoded;
}

function decode<T>(value: string | null): T | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    // Позволяет прочитать значения, записанные напрямую через redis-cli.
    return value as T;
  }
}

class IoredisClient implements RedisClient {
  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    return decode<T>(await this.client.get(key));
  }

  async set(
    key: string,
    value: unknown,
    options: RedisSetOptions = {},
  ): Promise<"OK" | null> {
    const encoded = encode(value);
    const { ex, px, nx } = options;

    if (ex !== undefined && nx)
      return this.client.set(key, encoded, "EX", ex, "NX");
    if (px !== undefined && nx)
      return this.client.set(key, encoded, "PX", px, "NX");
    if (ex !== undefined) return this.client.set(key, encoded, "EX", ex);
    if (px !== undefined) return this.client.set(key, encoded, "PX", px);
    if (nx) return this.client.set(key, encoded, "NX");
    return this.client.set(key, encoded);
  }

  del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  rpush(key: string, ...values: unknown[]): Promise<number> {
    return this.client.rpush(key, ...values.map(encode));
  }

  async lpop<T>(key: string): Promise<T | null> {
    return decode<T>(await this.client.lpop(key));
  }

  sadd(key: string, ...members: unknown[]): Promise<number> {
    return this.client.sadd(key, ...members.map(encode));
  }

  srem(key: string, ...members: unknown[]): Promise<number> {
    return this.client.srem(key, ...members.map(encode));
  }

  async smembers<T = string>(key: string): Promise<T[]> {
    return (await this.client.smembers(key)).map(
      (value) => decode<T>(value) as T,
    );
  }

  async hgetall<T extends Record<string, unknown>>(
    key: string,
  ): Promise<T | null> {
    const fields = await this.client.hgetall(key);
    if (Object.keys(fields).length === 0) return null;
    return Object.fromEntries(
      Object.entries(fields).map(([field, value]) => [field, decode(value)]),
    ) as T;
  }

  hset(key: string, fields: Record<string, unknown>): Promise<number> {
    const encoded = Object.fromEntries(
      Object.entries(fields).map(([field, value]) => [field, encode(value)]),
    );
    return this.client.hset(key, encoded);
  }

  hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(key, ...fields);
  }

  hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hincrby(key, field, increment);
  }

  expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  zadd(
    key: string,
    entry: { score: number; member: unknown },
  ): Promise<number> {
    return this.client.zadd(key, entry.score, encode(entry.member));
  }

  zrem(key: string, ...members: unknown[]): Promise<number> {
    return this.client.zrem(key, ...members.map(encode));
  }

  async zrange<T>(
    key: string,
    start: number,
    stop: number,
    options: { byScore?: boolean } = {},
  ): Promise<T> {
    const values = options.byScore
      ? await this.client.zrangebyscore(key, start, stop)
      : await this.client.zrange(key, start, stop);
    return values.map((value) => decode(value)) as T;
  }

  eval(script: string, keys: string[], args: unknown[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...args.map(encode));
  }
}

let sharedClient: RedisClient | undefined;

export function isRedisConfigured(): boolean {
  return Boolean(env.REDIS_URL || env.REDIS_HOST);
}

export function createRedisClient(): RedisClient {
  if (sharedClient) return sharedClient;
  if (!isRedisConfigured()) {
    throw new Error("REDIS_URL или REDIS_HOST не задан");
  }

  const client = env.REDIS_URL
    ? new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      })
    : new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });

  client.on("error", (error) => {
    console.error(`[redis] ${error.message}`);
  });
  sharedClient = new IoredisClient(client);
  return sharedClient;
}

export function createRedisStorage<T>(redis: RedisClient): StorageAdapter<T> {
  return {
    async read(key: string) {
      return (await redis.get<T>(key)) ?? undefined;
    },
    async write(key: string, value: T) {
      await redis.set(key, value);
    },
    async delete(key: string) {
      await redis.del(key);
    },
  };
}
