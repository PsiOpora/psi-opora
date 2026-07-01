import { type Conversation } from "@grammyjs/conversations";
import type { ConvContext } from "../types/context.js";
import { createBitrixDeal } from "../utils/bitrix.js";

function hasPhoneNumber(text: string): boolean {
  return /[\d\s\+\-\(\)]{7,}/.test(text);
}

export async function consultationConversation(
  conv: Conversation<ConvContext, ConvContext>,
  ctx: ConvContext
) {
  const messenger = "telegram";
  const nameCtx = await conv.wait();
  const name = nameCtx.message?.text?.trim() ?? "";

  if (!name) {
    await nameCtx.reply("Пожалуйста, введите ваше имя. Например: Анна");
    return;
  }

  await nameCtx.reply(
    `Отлично, ${name}! Теперь введите, пожалуйста, ваш номер телефона для связи.`
  );

  let attempts = 0;
  while (attempts < 3) {
    const phoneCtx = await conv.wait();
    const phoneText = phoneCtx.message?.text?.trim() ?? "";

    if (hasPhoneNumber(phoneText)) {
      const sessionData = await conv.external((c) => ({
        campaign: c.session.campaign,
        userId: c.from?.id,
      }));

      await conv.external((c) => {
        c.session.name = name;
        c.session.phone = phoneText;
        c.session.step = "done";
      });

      console.log(
        `[CONSULTATION] name=${name} phone=${phoneText}${sessionData.campaign ? ` campaign=${sessionData.campaign}` : ""} user=${sessionData.userId} messenger=${messenger}`
      );

      try {
        await createBitrixDeal({
          name,
          phone: phoneText,
          campaign: sessionData.campaign,
          telegramUserId: sessionData.userId,
          messenger,
        });
      } catch (err: any) {
        console.error("[bitrix] ошибка:", err.message);
      }

      await phoneCtx.reply(
        "✅ *Заявка принята!*\n\n" +
          `${name}, наш администратор свяжется с вами в ближайшие 30 минут, чтобы подтвердить запись на консультацию.\n\n` +
          "А пока вы можете:\n" +
          "📖 Узнать больше о наших специалистах: https://psi-opora.ru/services\n" +
          "💬 Задать вопрос в чат\n\n" +
          "Хорошего дня! 🌿",
        { parse_mode: "Markdown" }
      );
      return;
    }

    attempts++;
    if (attempts >= 3) {
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
}
