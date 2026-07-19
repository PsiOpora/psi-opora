"use server";

import { revalidatePath } from "next/cache";
import { addCost, deleteCost } from "@/lib/marketing/costs";

export async function addCostAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const month = String(formData.get("month") ?? "").trim();
  const utmSource = String(formData.get("utmSource") ?? "").trim();
  const utmCampaign = String(formData.get("utmCampaign") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(",", "."));
  const note = String(formData.get("note") ?? "").trim();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: "Укажите месяц" };
  }
  if (!utmSource) {
    return { ok: false, error: "Укажите UTM source" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Сумма должна быть больше нуля" };
  }

  try {
    await addCost({ month, utmSource, utmCampaign, amount, note });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath("/costs");
  return { ok: true };
}

export async function deleteCostAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Запись не найдена" };
  try {
    await deleteCost(id);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath("/costs");
  return { ok: true };
}
