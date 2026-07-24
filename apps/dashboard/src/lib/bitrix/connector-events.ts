import type { B24Frame } from "@bitrix24/b24jssdk";

// Официальный туториал Bitrix24 по разработке коннектора Открытых линий
// требует пары imconnector.register + event.bind на OnImConnectorMessageAdd:
// https://apidocs.bitrix24.ru/tutorials/openlines/example-connector.html
// Коннектор работает только в контексте приложения (OAuth) — обычный
// вебхук для event.bind не подходит, поэтому это делает браузерный SDK
// сразу после регистрации коннектора, а не серверный код.
// OnImConnectorStatusDelete/OnImConnectorLineDelete нужны, чтобы запись в
// bot_connectors подчищалась сама при отключении канала прямо в Bitrix
// (см. handleConnectorDisabled в apps/bitrix-webhook).
const CONNECTOR_EVENTS = [
  "OnImConnectorMessageAdd",
  "OnImConnectorStatusDelete",
  "OnImConnectorLineDelete",
] as const;

/**
 * Подписывает приложение на события коннектора Открытых линий — вызывать
 * сразу после успешного imconnector.register. Ошибка по одному событию не
 * прерывает остальные; возвращает список описаний неудачных подписок
 * (пустой массив — всё получилось), чтобы вызывающий код мог показать
 * предупреждение, не блокируя уже случившуюся регистрацию коннектора.
 */
export async function subscribeConnectorEvents(
  b24: B24Frame,
  handlerUrl: string,
): Promise<string[]> {
  const failures: string[] = [];
  for (const event of CONNECTOR_EVENTS) {
    try {
      const res = await b24.callMethod("event.bind", { event, handler: handlerUrl });
      if (!res.isSuccess) {
        const messages = res.getErrorMessages();
        // Bitrix хранит привязки идемпотентно по паре (event, handler) и
        // возвращает эту ошибку, если обработчик уже подписан — по факту
        // цель уже достигнута, поэтому это не сбой.
        const alreadyBound = messages.some((m) => /already binded/i.test(m));
        if (!alreadyBound) {
          failures.push(`${event}: ${messages.join("; ")}`);
        }
      }
    } catch (err) {
      failures.push(`${event}: ${(err as Error).message}`);
    }
  }
  return failures;
}
