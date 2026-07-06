import { type Conversation } from "@grammyjs/conversations";
import type { ConvContext } from "../types/context.js";
import { createBitrixDeal } from "../utils/bitrix.js";
import { createUpstashRedis, getBitrixChatInfo } from "../storage/upstash.js";
import { trackFunnelStep, type FunnelStep } from "../utils/funnel.js";

// Redis-инстанс для получения chatId из Bitrix webhook
let _redis: ReturnType<typeof createUpstashRedis> | null = null;
function getRedis() {
  if (!_redis) {
    try {
      _redis = createUpstashRedis();
    } catch {
      return null;
    }
  }
  return _redis;
}

function hasPhoneNumber(text: string): boolean {
  return /[\d\s\+\-\(\)]{7,}/.test(text);
}

function isValidEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

export async function consultationConversation(
  conv: Conversation<ConvContext, ConvContext>,
  ctx: ConvContext
) {
  const messenger = "telegram";
  const sessionData = await conv.external((c) => ({
    campaign: c.session.campaign,
    source: c.session.source,
    userId: c.from?.id,
  }));
  // conv.external — чтобы шаг не задвоился при replay диалога conversations
  const track = (step: FunnelStep) =>
    conv.external(() =>
      trackFunnelStep(step, { messenger, source: sessionData.source, campaign: sessionData.campaign }),
    );

  const nameCtx = await conv.wait();
  const name = nameCtx.message?.text?.trim() ?? "";

  if (!name) {
    await nameCtx.reply("Пожалуйста, введите ваше имя. Например: Анна");
    return;
  }

  await track("name");
  await nameCtx.reply(
    `Отлично, ${name}! Теперь введите, пожалуйста, ваш номер телефона для связи.`
  );

  let phone = "";
  let phoneAttempts = 0;
  while (phoneAttempts < 3) {
    const phoneCtx = await conv.wait();
    const phoneText = phoneCtx.message?.text?.trim() ?? "";

    if (hasPhoneNumber(phoneText)) {
      phone = phoneText;
      break;
    }

    phoneAttempts++;
    if (phoneAttempts >= 3) {
      await phoneCtx.reply(
        "😔 К сожалению, мы не смогли распознать номер. " +
          "Напишите, пожалуйста, номер в любом формате: +7 999 123-45-67, " +
          "8 999 123 45 67 и т.д. Мы свяжемся с вами для уточнения."
      );
      return;
    }

    await phoneCtx.reply(
      "Не удалось распознать номер телефона. Введите, пожалуйста, номер в любом формате, например: +7 (999) 123-45-67"
    );
  }

  await track("phone");
  await ctx.reply(
    "Спасибо! И последний шаг — укажите, пожалуйста, ваш email для связи."
  );

  let email = "";
  let emailAttempts = 0;
  while (emailAttempts < 3) {
    const emailCtx = await conv.wait();
    const emailText = emailCtx.message?.text?.trim() ?? "";

    if (isValidEmail(emailText)) {
      email = emailText;
      break;
    }

    emailAttempts++;
    if (emailAttempts >= 3) {
      await emailCtx.reply(
        "😔 Не удалось распознать email, продолжим без него — уточним при звонке."
      );
      break;
    }

    await emailCtx.reply(
      "Не удалось распознать email. Введите, пожалуйста, адрес в формате: example@mail.ru"
    );
  }

  await conv.external((c) => {
    c.session.name = name;
    c.session.phone = phone;
    c.session.email = email || undefined;
    c.session.step = "done";
  });

  console.log(
    `[CONSULTATION] name=${name} phone=${phone}${email ? ` email=${email}` : ""}${sessionData.source ? ` source=${sessionData.source}` : ""}${sessionData.campaign ? ` campaign=${sessionData.campaign}` : ""} user=${sessionData.userId} messenger=${messenger}`
  );

  try {
    let chatId: number | undefined;
    let operatorId: number | undefined;

    const redis = getRedis();
    if (redis && sessionData.userId) {
      const chatInfo = await getBitrixChatInfo(redis, sessionData.userId);
      if (chatInfo) {
        chatId = chatInfo.chatId;
        operatorId = chatInfo.operatorId || undefined;
        console.log(`[CONSULTATION] найден chatId=${chatId} для userId=${sessionData.userId}`);
      }
    }

    await createBitrixDeal({
      name,
      phone,
      email: email || undefined,
      campaign: sessionData.campaign,
      source: sessionData.source,
      telegramUserId: sessionData.userId,
      messenger,
      chatId,
      operatorId,
    });
    await track("deal");
  } catch (err: any) {
    console.error("[bitrix] ошибка:", err.message);
  }

  await ctx.reply(
    "✅ *Заявка принята!*\n\n" +
      `${name}, наш администратор свяжется с вами в ближайшие 30 минут, чтобы подтвердить запись на консультацию.\n\n` +
      "А пока вы можете:\n" +
      "📖 Узнать больше о наших специалистах: https://psi-opora.ru/services\n" +
      "💬 Задать вопрос в чат\n\n" +
      "Хорошего дня! 🌿",
    { parse_mode: "Markdown" }
  );
}
