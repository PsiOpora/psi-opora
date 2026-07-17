"use server";

import { SCENARIO_TEXT_DEFS } from "@psi-opora/bot-core";
import { revalidatePath } from "next/cache";
import { orpc } from "@/lib/orpc-client";

export async function saveBotTextsAction(formData: FormData): Promise<void> {
  const entries: Record<string, string> = {};
  for (const def of SCENARIO_TEXT_DEFS) {
    const value = String(formData.get(def.key) ?? "");
    // Текст, совпадающий с дефолтным, не сохраняем как переопределение
    entries[def.key] = value.trim() === def.defaultValue.trim() ? "" : value;
  }

  await orpc.botTexts.save(entries);
  revalidatePath("/settings/bot");
}
