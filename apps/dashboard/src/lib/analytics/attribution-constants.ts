/** Синтетическая строка ниже — расход, который есть в ad_daily_stats, но не
 * сматчился ни с одной UTM-кампанией (см. buildUnattributedRow в attribution.ts).
 * Вынесено из attribution.ts отдельно, потому что тот файл тянет
 * @psi-opora/db/queries (node-postgres) и не может импортироваться из
 * клиентских компонентов. */
export const UNATTRIBUTED_KEY = "__unattributed_spend__";
