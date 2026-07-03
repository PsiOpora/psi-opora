"use server";

import { revalidatePath } from "next/cache";
import { addCost, deleteCost } from "@/lib/marketing/costs";

export async function addCostAction(formData: FormData): Promise<void> {
  const month = String(formData.get("month") ?? "").trim();
  const utmSource = String(formData.get("utmSource") ?? "").trim();
  const utmCampaign = String(formData.get("utmCampaign") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(",", "."));
  const note = String(formData.get("note") ?? "").trim();

  if (!/^\d{4}-\d{2}$/.test(month) || !utmSource || !Number.isFinite(amount) || amount <= 0) return;

  await addCost({ month, utmSource, utmCampaign, amount, note });
  revalidatePath("/costs");
}

export async function deleteCostAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteCost(id);
  revalidatePath("/costs");
}
