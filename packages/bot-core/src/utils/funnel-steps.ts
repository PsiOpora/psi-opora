/**
 * Шаги воронки бота в порядке прохождения сценария.
 * После start пользователь идёт одной из двух веток:
 * консультация (consult_click → consent → name → phone → deal) или
 * гайд (guide_click → consent → category → issue → email → phone → deal → subscribe).
 * Конверсии между шагами разных веток читаются с поправкой на ветвление.
 *
 * Вынесено в отдельный файл без серверных зависимостей (ioredis, db), чтобы
 * его можно было импортировать из клиентского кода (см. exports."./funnel-steps"
 * в package.json).
 */
export const FUNNEL_STEPS = [
	"start",
	"consult_click",
	"consent",
	"marketing_consent",
	"name",
	"guide_click",
	"category",
	"issue",
	"email",
	"phone",
	"deal",
	"subscribe",
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
