"use server";

import { upsertUnisenderSettings } from "@psi-opora/db/queries";
import { revalidatePath } from "next/cache";

export async function saveUnisenderSettingsAction(
  formData: FormData,
): Promise<void> {
  const apiKey = String(formData.get("apiKey") ?? "").trim() || undefined;
  const senderEmail =
    String(formData.get("senderEmail") ?? "").trim() || undefined;
  const senderName =
    String(formData.get("senderName") ?? "").trim() || undefined;

  await upsertUnisenderSettings({ apiKey, senderEmail, senderName });

  revalidatePath("/settings/email");
}
