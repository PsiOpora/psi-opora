import { bitrixPost, getEnv } from "./client";

// ID пользователя Bitrix24 по умолчанию для задач, требующих ручного
// вмешательства менеджера (Андрей Клюев) — тот же дефолт, что и для
// консультаций (packages/jobs/src/consultation-reminders.ts).
const DEFAULT_TASK_RESPONSIBLE_ID = 1;

function taskResponsibleId(messenger: string): number {
  const configured = Number(getEnv(messenger, "BITRIX_GUIDE_TASK_USER_ID"));
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_TASK_RESPONSIBLE_ID;
}

/**
 * Создаёт в Bitrix24 задачу ответственному менеджеру, привязанную к сделке.
 * Используется, когда бот не смог отправить материал клиенту на email (адрес
 * не оставлен или письмо не ушло) — менеджер должен сам уточнить адрес или
 * прислать материал другим способом, вместо того чтобы это обнаружилось
 * случайно при просмотре переписки (см. describeGuideHandout в dispatch.ts).
 */
export async function createBitrixTask(
  messenger: string,
  params: { title: string; description: string; dealId?: number },
): Promise<void> {
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl) return;

  try {
    await bitrixPost(
      "tasks.task.add",
      {
        fields: {
          TITLE: params.title,
          DESCRIPTION: params.description,
          RESPONSIBLE_ID: taskResponsibleId(messenger),
          ...(params.dealId ? { UF_CRM_TASK: [`D_${params.dealId}`] } : {}),
        },
      },
      messenger,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bitrix] не удалось создать задачу: ${message}`);
  }
}
