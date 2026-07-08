"use server";

import { revalidatePath } from "next/cache";
import { orpc } from "@/lib/orpc-client";

export async function saveAdCredentialsAction(formData: FormData): Promise<void> {
  const yandexClientId = String(formData.get("yandexClientId") ?? "").trim() || undefined;
  const yandexClientSecret = String(formData.get("yandexClientSecret") ?? "").trim() || undefined;
  const yandexRefreshToken = String(formData.get("yandexRefreshToken") ?? "").trim() || undefined;
  const vkAccessToken = String(formData.get("vkAccessToken") ?? "").trim() || undefined;
  const vkAdsAccountId = String(formData.get("vkAdsAccountId") ?? "").trim() || undefined;

  await orpc.ads.upsertCredentials({
    yandexClientId,
    yandexClientSecret,
    yandexRefreshToken,
    vkAccessToken,
    vkAdsAccountId,
  });

  revalidatePath("/settings/ads");
}
