import type { RedisClient } from "../storage/redis";

const LOCK_TTL_MS = 20_000;
// Продлеваем задолго до истечения TTL — 2-3 продления за время жизни лока
// дают запас на джиттер event loop, не полагаясь на то, что первое же
// продление успеет выполниться точно вовремя.
const RENEW_INTERVAL_MS = 7_000;
const POLL_INTERVAL_MS = 150;
// Короче LOCK_TTL_MS и не завязан на него: ждём столько же, сколько сами
// готовы терпеть задержку ответа боту (ориентир — таймаут TG-вебхука,
// см. apps/tg-bot/src/server.ts, onTimeout: 15_000). Если держатель лока
// жив и продлевает его — это осознанный компромисс: изредка второй апдейт
// того же пользователя, пришедший во время необычно долгой обработки
// первого (скачивание аватара, вызов Bitrix, вложенный LLM-запрос), отвалится
// с ошибкой вместо того, чтобы ждать дальше. Это безопаснее, чем раньше:
// раньше по таймауту код тихо выполнял fn() без лока и воспроизводил ту
// самую гонку, которую лок должен закрывать (зацикливание шага согласия,
// задвоенные заявки).
const MAX_WAIT_MS = 12_000;

// Снятие/продление лока — атомарно через Lua-скрипт (compare-and-delete /
// compare-and-expire по токену), а не отдельными GET+DEL/PEXPIRE: иначе
// между чтением и записью в лок мог успеть вклиниться другой держатель
// (TTL истёк и лок перехватили) — и мы бы сняли/продлили чужой лок.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

/**
 * Сериализует обработку апдейтов одного и того же пользователя через
 * распределённый лок в Redis (SET NX PX + продление по хартбиту + снятие
 * атомарным compare-and-delete).
 *
 * Без этого сессия читается и пишется двумя раздельными Redis-вызовами
 * (см. storage/redis.ts) без транзакции/блокировки: два почти
 * одновременных апдейта от одного клиента (двойной тап по кнопке,
 * повторная доставка вебхука) читают одно и то же старое состояние и оба
 * продвигают сценарий от него — на проде это давало зацикливание шага
 * согласия на ПДн и задвоенные заявки. Лок оборачивает всю цепочку
 * обработки апдейта, включая session-middleware, так что второй апдейт
 * ждёт, пока первый полностью дочитает и допишет сессию.
 *
 * Если дождаться лока не удалось (MAX_WAIT_MS) — бросает ошибку вместо
 * того, чтобы тихо выполнить fn() без лока: лучше явно уронить апдейт
 * (адаптеры уже ловят такие ошибки в bot.catch и отвечают "что-то пошло не
 * так") и воспроизвести гонку, которую лок должен закрывать.
 *
 * Без Redis (локальная разработка/тесты) — no-op, просто выполняет fn.
 */
export async function withUserLock<T>(
  redis: RedisClient | undefined,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!redis) return fn();

  const lockKey = `lock:session:${key}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + MAX_WAIT_MS;

  let acquired = false;
  while (!acquired) {
    acquired = Boolean(
      await redis.set(lockKey, token, { nx: true, px: LOCK_TTL_MS }),
    );
    if (acquired) break;
    if (Date.now() >= deadline) {
      throw new Error(
        `[lock] не удалось получить ${lockKey} за ${MAX_WAIT_MS}мс`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Пока fn() выполняется — продлеваем TTL, чтобы не потерять лок на
  // легитимно долгих путях (скачивание/заливка аватара, вызовы Bitrix API,
  // вложенный LLM-запрос на шаге "имя") раньше, чем обработка реально
  // завершится.
  const renewTimer = setInterval(() => {
    redis.eval(RENEW_SCRIPT, [lockKey], [token, LOCK_TTL_MS]).catch((err) => {
      console.error(
        `[lock] не удалось продлить ${lockKey}: ${(err as Error).message}`,
      );
    });
  }, RENEW_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    clearInterval(renewTimer);
    await redis.eval(RELEASE_SCRIPT, [lockKey], [token]).catch((err) => {
      console.error(
        `[lock] не удалось снять ${lockKey}: ${(err as Error).message}`,
      );
    });
  }
}
