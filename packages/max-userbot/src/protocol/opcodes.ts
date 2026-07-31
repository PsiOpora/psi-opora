/**
 * Opcode'ы протокола MAX/OneMe — не задокументированы официально. Номера
 * (Фаза 1: SESSION_INIT/AUTH_REQUEST/AUTH/LOGIN) сведены из открытых
 * разборов (гайд PronikFire/Max-API-Guide — полная таблица opcode,
 * подтверждённая исходниками Android-приложения 26.23.1; гист
 * koval01/analysis.md; maxcalls/docs/api/oneme.md). Опкоды для отправки/
 * приёма сообщений (Фаза 2) взяты из той же таблицы PronikFire/Max-API-Guide
 * (без пометки `~`, т.е. подтверждены исходниками) и перепроверены по двум
 * независимым рабочим клиентам — Grovvik/vkmax-nodejs (messages.js) и
 * nsdkinx/vkmax (vkmax/functions/messages.py) — оба используют те же номера
 * с одинаковой формой пейлоада, что для протокола MAX/OneMe большая редкость
 * (обычно только номера подтверждены, форма — нет).
 */
export const OPCODE = {
  /** Инициализация сессии устройства — первый запрос на новом соединении. */
  SESSION_INIT: 6,
  /** Запрос SMS-кода по номеру телефона. */
  AUTH_REQUEST: 17,
  /** Подтверждение кода из SMS. */
  AUTH: 18,
  /** Вход по токену (свежий из AUTH или сохранённый из прошлой сессии) —
   * используется на каждом новом подключении, а не только при первом входе
   * (см. login.ts и relay.ts: `tokenAttrs.LOGIN.token` персистится и
   * предъявляется здесь заново при каждом реконнекте воркера). */
  LOGIN: 19,
  /** Онлайн-статус контактов — `contactIds` + опциональный `sync`. */
  CONTACT_PRESENCE: 35,
  /** Резолв контакта по номеру телефона — для «написать первым». */
  CONTACT_INFO_BY_PHONE: 46,
  /** Отправка сообщения: `{ chatId, message: { text, cid, elements,
   * attaches, link? }, notify }` — форма подтверждена рабочим кодом
   * Grovvik/vkmax-nodejs и nsdkinx/vkmax (`sendMessage`/`send_message`). */
  MSG_SEND: 64,
  /** Индикатор набора текста. */
  MSG_TYPING: 65,
  /** Удаление сообщений: `{ chatId, messageIds, forMe }`. */
  MSG_DELETE: 66,
  /** Редактирование сообщения: `{ chatId, messageId, text, elements,
   * attachments }`. */
  MSG_EDIT: 67,
  /** Пуш нового сообщения (сервер→клиент, без ожидающего запроса). Точная
   * раскладка полей нигде не задокументирована — см. предупреждение в
   * relay.ts и scripts/manual-relay.ts для живой проверки. */
  NOTIF_MESSAGE: 128,
  /** Пуш индикатора набора текста собеседником. */
  NOTIF_TYPING: 129,
  /** Пуш о прочтении сообщения. */
  NOTIF_MARK: 130,
  /** Пуш смены онлайн-статуса контакта. */
  NOTIF_PRESENCE: 132,
} as const;
