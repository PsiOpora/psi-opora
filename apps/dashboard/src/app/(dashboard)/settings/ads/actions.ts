"use server";

import { revalidatePath } from "next/cache";
import { upsertAdCredentials } from "@psi-opora/db/queries";

export async function saveAdCredentialsAction(formData: FormData): Promise<void> {
  const yandexClientId = String(formData.get("yandexClientId") ?? "").trim() || null;
  const yandexClientSecret = String(formData.get("yandexClientSecret") ?? "").trim() || null;
  const yandexRefreshToken = String(formData.get("yandexRefreshToken") ?? "").trim() || null;
  const vkAccessToken = String(formData.get("vkAccessToken") ?? "").trim() || null;
  const vkAdsAccountId = String(formData.get("vkAdsAccountId") ?? "").trim() || null;

  await upsertAdCredentials({
    yandexClientId,
    yandexClientSecret,
    yandexRefreshToken,
    vkAccessToken,
    vkAdsAccountId,
  });

  revalidatePath("/settings/ads");
}
