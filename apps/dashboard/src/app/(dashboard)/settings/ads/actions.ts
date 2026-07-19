"use server";

import { revalidatePath } from "next/cache";
import { orpc } from "@/lib/orpc-client";

export async function saveAdCredentialsAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const yandexClientId =
    String(formData.get("yandexClientId") ?? "").trim() || undefined;
  const yandexClientSecret =
    String(formData.get("yandexClientSecret") ?? "").trim() || undefined;
  const yandexRefreshToken =
    String(formData.get("yandexRefreshToken") ?? "").trim() || undefined;
  const vkAccessToken =
    String(formData.get("vkAccessToken") ?? "").trim() || undefined;
  const vkAdsAccountId =
    String(formData.get("vkAdsAccountId") ?? "").trim() || undefined;

  try {
    await orpc.ads.upsertCredentials({
      yandexClientId,
      yandexClientSecret,
      yandexRefreshToken,
      vkAccessToken,
      vkAdsAccountId,
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath("/settings/ads");
  return { ok: true };
}
