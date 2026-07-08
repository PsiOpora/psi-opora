import { type Conversation } from "@grammyjs/conversations";
import type { ConvContext } from "../types/context";
import { trackFunnelStep, type FunnelStep } from "../utils/funnel";
import { hasPhoneNumber, isValidEmail } from "../utils/validation";
import { submitConsultationDeal } from "../utils/consultation-deal";
import { successReply } from "../utils/messages";

export async function consultationConversation(
  conv: Conversation<ConvContext, ConvContext>,
  ctx: ConvContext,
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
      trackFunnelStep(step, {
        messenger,
        source: sessionData.source,
        campaign: sessionData.campaign,
      }),
    );

  const nameCtx = await conv.wait();
  const name = nameCtx.message?.text?.trim() ?? "";

  if (!name) {
    await nameCtx.reply("Пожалуйста, введите ваше имя. Например: Анна");
    return;
  }

  await track("name");
  await nameCtx.reply(
    `Отлично, ${name}! Теперь введите, пожалуйста, ваш номер телефона для связи.`,
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
          "8 999 123 45 67 и т.д. Мы свяжемся с вами для уточнения.",
      );
      return;
    }

    await phoneCtx.reply(
      "Не удалось распознать номер телефона. Введите, пожалуйста, номер в любом формате, например: +7 (999) 123-45-67",
    );
  }

  await track("phone");
  await ctx.reply(
    "Спасибо! И последний шаг — укажите, пожалуйста, ваш email для связи.",
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
        "😔 Не удалось распознать email, продолжим без него — уточним при звонке.",
      );
      break;
    }

    await emailCtx.reply(
      "Не удалось распознать email. Введите, пожалуйста, адрес в формате: example@mail.ru",
    );
  }

  await conv.external((c) => {
    c.session.name = name;
    c.session.phone = phone;
    c.session.email = email || undefined;
    c.session.step = "done";
  });

  console.log(
    `[CONSULTATION] name=${name} phone=${phone}${email ? ` email=${email}` : ""}${sessionData.source ? ` source=${sessionData.source}` : ""}${sessionData.campaign ? ` campaign=${sessionData.campaign}` : ""} user=${sessionData.userId} messenger=${messenger}`,
  );

  await conv.external(() =>
    submitConsultationDeal({
      name,
      phone,
      email: email || undefined,
      messenger,
      userId: sessionData.userId,
      source: sessionData.source,
      campaign: sessionData.campaign,
    }),
  );

  await ctx.reply(successReply(name), { parse_mode: "Markdown" });
}
