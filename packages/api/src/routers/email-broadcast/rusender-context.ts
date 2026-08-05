import {
  getRusenderSettings,
  type RusenderSettings,
} from "@psi-opora/db/queries";
import {
  createRusenderClient,
  type RusenderClient,
} from "@psi-opora/rusender-client";

export async function getRusenderContext(): Promise<{
  client: RusenderClient;
  settings: RusenderSettings;
} | null> {
  const settings = await getRusenderSettings();
  if (!settings?.apiKey || !settings.keyId) return null;
  return { client: createRusenderClient(settings.apiKey, settings.keyId), settings };
}
