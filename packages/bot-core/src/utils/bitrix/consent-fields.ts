/**
 * Поля согласия на обработку ПДн в карточке контакта Bitrix24. Пишутся в
 * buildConsentFields (contact.ts), читаются в resolveKnownContact
 * (known-contact.ts) — по ним бот решает, показывать ли экран согласия уже
 * известному клиенту.
 */

/** Флажок «согласие на ПДн получено». */
export const CONSENT_PDN_FLAG_FIELD = "UF_CRM_CONTACT_1779910236669";
/**
 * Дата/время согласия на ПДн. Имя — как его отдаёт портал
 * (crm.contact.userfield.list): без «CONTACT_», в отличие от флажка выше.
 * Запись в несуществующее поле Bitrix молча игнорирует.
 */
export const CONSENT_PDN_DATE_FIELD = "UF_CRM_CONSENT_PDN_DT";
