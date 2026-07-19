"use server";

import { upsertUnisenderSettings } from "@psi-opora/db/queries";
import { revalidatePath } from "next/cache";

export async function saveUnisenderSettingsAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = String(formData.get("apiKey") ?? "").trim() || undefined;
  const senderEmail =
    String(formData.get("senderEmail") ?? "").trim() || undefined;
  const senderName =
    String(formData.get("senderName") ?? "").trim() || undefined;

  try {
    await upsertUnisenderSettings({ apiKey, senderEmail, senderName });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath("/settings/email");
  return { ok: true };
}
