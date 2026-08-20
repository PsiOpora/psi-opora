import { upsertBotUser } from "@psi-opora/db/queries";

export interface BotUserProfileInput {
	messenger: string;
	userId: number | string | undefined;
	firstName?: string;
	lastName?: string;
	name?: string;
	username?: string;
	languageCode?: string;
	isPremium?: boolean;
	isBot?: boolean;
	bio?: string;
	photoFileId?: string;
	avatarS3Key?: string;
	source?: string;
	campaign?: string;
	rawProfile?: unknown;
}

/**
 * Сохраняет профиль клиента, полученный из мессенджера (апдейт + getChat),
 * в bot_users — источник для обогащения карточки CRM. Ошибки записи
 * не должны ломать диалог с клиентом — логируются и глотаются.
 */
export async function upsertBotUserProfile(
	entry: BotUserProfileInput,
): Promise<void> {
	if (entry.userId === undefined || entry.userId === null) return;

	try {
		await upsertBotUser({
			messenger: entry.messenger,
			userId: String(entry.userId),
			firstName: entry.firstName,
			lastName: entry.lastName,
			name: entry.name,
			username: entry.username,
			languageCode: entry.languageCode,
			isPremium: entry.isPremium,
			isBot: entry.isBot,
			bio: entry.bio,
			photoFileId: entry.photoFileId,
			avatarS3Key: entry.avatarS3Key,
			source: entry.source,
			campaign: entry.campaign,
			rawProfile: entry.rawProfile,
		});
	} catch (err) {
		const error = err as Error;
		console.error(
			`[profile] не удалось сохранить профиль пользователя: ${error.message}`,
			error.cause ?? "",
		);
	}
}
