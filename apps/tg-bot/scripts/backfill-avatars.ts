import { resolveTelegramBotToken } from "@psi-opora/bot-core";
import {
  listBotUsersMissingAvatarUpload,
  upsertBotUser,
} from "@psi-opora/db/queries";
import { Api } from "grammy";
import { uploadTelegramAvatar } from "../src/avatar-storage.js";

/**
 * Разовая перезаливка аватаров для клиентов, обратившихся до того, как бот
 * начал скачивать фото профиля в своё S3 (см. collectTelegramProfile) —
 * до этого сохранялся только временный photoFileId. Запускать вручную:
 *   bun run --env-file=../../.env scripts/backfill-avatars.ts
 */

const token = await resolveTelegramBotToken();
if (!token) {
  console.error("Нужен токен бота в БД (настройки канала в Открытых линиях)");
  process.exit(1);
}

const api = new Api(token);
const users = await listBotUsersMissingAvatarUpload("telegram");
console.log(`Найдено профилей без перезалитого аватара: ${users.length}`);

let done = 0;
let failed = 0;

for (const user of users) {
  if (!user.photoFileId) continue;
  try {
    const file = await api.getFile(user.photoFileId);
    if (!file.file_path) throw new Error("нет file_path");

    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`скачивание не удалось: HTTP ${res.status}`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const uploaded = await uploadTelegramAvatar({
      bytes,
      contentType,
      messenger: "telegram",
      userId: Number(user.userId),
    });

    await upsertBotUser({
      messenger: "telegram",
      userId: user.userId,
      avatarUrl: uploaded.avatarUrl,
      avatarS3Key: uploaded.avatarS3Key,
    });

    done++;
    console.log(`✓ user=${user.userId}`);
  } catch (err) {
    failed++;
    console.error(`✗ user=${user.userId}: ${(err as Error).message}`);
  }
  // Не долбим Telegram API без пауз — лимит на getFile не документирован жёстко.
  await new Promise((resolve) => setTimeout(resolve, 200));
}

console.log(`Готово: ${done} перезалито, ${failed} с ошибкой из ${users.length}`);
