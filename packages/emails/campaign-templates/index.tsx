import { render } from "@react-email/components";
import type { ComponentType } from "react";

import PromoEmail from "./promo";
import SimpleAnnouncementEmail from "./simple";
import UpdateEmail from "./update";

export interface CampaignTemplateFieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "url";
  placeholder?: string;
}

export interface CampaignTemplateDef {
  key: string;
  label: string;
  description: string;
  fields: CampaignTemplateFieldDef[];
  defaultValues: Record<string, string>;
  component: ComponentType<Record<string, string>>;
}

export const CAMPAIGN_TEMPLATES: CampaignTemplateDef[] = [
  {
    key: "simple",
    label: "Простое объявление",
    description: "Заголовок, текст и необязательная кнопка — на любой случай.",
    fields: [
      { key: "heading", label: "Заголовок", type: "text" },
      { key: "body", label: "Текст письма", type: "textarea" },
      { key: "buttonText", label: "Текст кнопки", type: "text" },
      { key: "buttonUrl", label: "Ссылка кнопки", type: "url" },
    ],
    defaultValues: {
      heading: "Заголовок письма",
      body: "Текст письма. Здесь можно рассказать получателю главное.",
      buttonText: "Подробнее",
      buttonUrl: "https://example.com",
    },
    component: SimpleAnnouncementEmail,
  },
  {
    key: "promo",
    label: "Акция / предложение",
    description: "Картинка, текст и кнопка — для промо и специальных предложений.",
    fields: [
      { key: "heading", label: "Заголовок", type: "text" },
      {
        key: "imageUrl",
        label: "Ссылка на картинку (необязательно)",
        type: "url",
      },
      { key: "body", label: "Текст письма", type: "textarea" },
      { key: "buttonText", label: "Текст кнопки", type: "text" },
      { key: "buttonUrl", label: "Ссылка кнопки", type: "url" },
    ],
    defaultValues: {
      heading: "Специальное предложение",
      imageUrl: "",
      body: "Расскажите о вашем предложении подробнее.",
      buttonText: "Узнать больше",
      buttonUrl: "https://example.com",
    },
    component: PromoEmail,
  },
  {
    key: "update",
    label: "Новости / обновление",
    description: "Вводный текст плюс выделенный блок с главным событием.",
    fields: [
      { key: "heading", label: "Заголовок", type: "text" },
      { key: "intro", label: "Вводный текст", type: "textarea" },
      { key: "highlightTitle", label: "Заголовок блока", type: "text" },
      { key: "highlightBody", label: "Текст блока", type: "textarea" },
      { key: "buttonText", label: "Текст кнопки", type: "text" },
      { key: "buttonUrl", label: "Ссылка кнопки", type: "url" },
    ],
    defaultValues: {
      heading: "Новости и обновления",
      intro: "Коротко о том, что нового.",
      highlightTitle: "Главное событие",
      highlightBody: "Опишите здесь самое важное.",
      buttonText: "Читать полностью",
      buttonUrl: "https://example.com",
    },
    component: UpdateEmail,
  },
];

export function getCampaignTemplateDef(
  key: string,
): CampaignTemplateDef | undefined {
  return CAMPAIGN_TEMPLATES.find((def) => def.key === key);
}

/** Рендерит шаблон кампании в HTML. Возвращает null, если ключ шаблона неизвестен. */
export async function renderCampaignTemplate(
  templateKey: string,
  fields: Record<string, string>,
): Promise<string | null> {
  const def = getCampaignTemplateDef(templateKey);
  if (!def) return null;
  const Component = def.component;
  return render(<Component {...fields} />);
}
