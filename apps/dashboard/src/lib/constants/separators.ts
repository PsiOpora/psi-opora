/**
 * Разделитель составного ключа utmCampaign (utm_source+utm_campaign) в
 * агрегациях по разрезу — совпадает с SQL-выражением chr(31) (Unit Separator)
 * в packages/db/src/queries/deals.ts::dimensionKeyExpr. chr(0) не подходит:
 * Postgres отклоняет нулевой байт внутри текстового значения ("null
 * character not permitted"). Общий модуль вместо дублирования
 * String.fromCharCode(31) в каждом потребителе (report/route.ts, costs/page.tsx).
 */
export const UTM_CAMPAIGN_KEY_SEPARATOR = String.fromCharCode(31);
