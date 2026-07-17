"use server";

import { SCENARIO_TEXT_DEFS } from "@psi-opora/bot-core";
// Тексты сохраняются напрямую из server action, без oRPC-роутера:
// /api/orpc не проверяет сессию, и публичная мутация позволила бы
// кому угодно переписать сообщения бота.
import { saveBotTexts } from "@psi-opora/db/queries";
import { revalidatePath } from "next/cache";

export async function saveBotTextsAction(formData: FormData): Promise<void> {
  const entries: Record<string, string> = {};
  for (const def of SCENARIO_TEXT_DEFS) {
    const value = String(formData.get(def.key) ?? "");
    // Текст, совпадающий с дефолтным, не сохраняем как переопределение
    entries[def.key] = value.trim() === def.defaultValue.trim() ? "" : value;
  }

  await saveBotTexts(entries);
  revalidatePath("/settings/bot");
}
