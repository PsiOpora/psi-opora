import {
	getUnisenderSettings,
	type UnisenderSettings,
} from "@psi-opora/db/queries";
import {
	createUnisenderClient,
	type UnisenderClient,
} from "@psi-opora/unisender-client";

export async function getUnisenderContext(): Promise<{
	client: UnisenderClient;
	settings: UnisenderSettings;
} | null> {
	const settings = await getUnisenderSettings();
	if (!settings?.apiKey) return null;
	return { client: createUnisenderClient(settings.apiKey), settings };
}
