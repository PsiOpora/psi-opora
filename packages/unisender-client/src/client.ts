const API_BASE = "https://api.unisender.com/ru/api";

interface RawResponse {
  result?: unknown;
  error?: string;
  code?: string;
}

function unwrap<T>(json: RawResponse, method: string): T {
  if (json.error) {
    throw new Error(
      `Unisender [${method}]: ${json.error}${json.code ? ` (${json.code})` : ""}`,
    );
  }
  return json.result as T;
}

/** Значения form-параметров Unisender API: скаляр, плоский массив или массив строк (для importContacts.data). */
type UnisenderParamValue = string | number | boolean | undefined;
type UnisenderParams = Record<
  string,
  UnisenderParamValue | UnisenderParamValue[] | UnisenderParamValue[][]
>;

export interface UnisenderTemplate {
  id: string;
  title: string;
  subject?: string;
  screenshot_url?: string;
  fullsize_screenshot_url?: string;
  type?: string;
  created?: string;
  updated?: string;
}

export interface UnisenderTemplateDetails extends UnisenderTemplate {
  body: string;
  lang_code?: string;
  message_format?: string;
}

export interface CreateListResult {
  id: number;
}

export interface ImportContactsResult {
  total: number;
  inserted: number;
  updated: number;
  invalid_emails?: string[];
  invalid_phones?: string[];
}

export interface CreateEmailMessageResult {
  message_id: number;
}

export interface CreateCampaignResult {
  campaign_id: number;
  status?: string;
}

export interface CampaignStatusResult {
  status: string;
}

export interface CampaignCommonStatsResult {
  total: number;
  sent?: number;
  delivered?: number;
  read_unique?: number;
  clicked_unique?: number;
  unsubscribed?: number;
  spam?: number;
}

/** Пары ["email", "name@example.com"] и т.п. — построчные данные для importContacts. */
export type ImportContactRow = string[];

export interface UnisenderClient {
  getTemplates(): Promise<UnisenderTemplate[]>;
  getTemplate(templateId: string): Promise<UnisenderTemplateDetails>;
  createList(title: string): Promise<CreateListResult>;
  importContacts(params: {
    fieldNames: string[];
    data: ImportContactRow[];
    listIds: number[];
    doubleOptin?: 0 | 1 | 3;
  }): Promise<ImportContactsResult>;
  createEmailMessage(params: {
    senderName: string;
    senderEmail: string;
    subject: string;
    templateId: string;
    listId: number;
    generateText?: boolean;
  }): Promise<CreateEmailMessageResult>;
  createCampaign(params: {
    messageId: number;
    trackRead?: boolean;
    trackLinks?: boolean;
  }): Promise<CreateCampaignResult>;
  getCampaignStatus(campaignId: number): Promise<CampaignStatusResult>;
  getCampaignCommonStats(
    campaignId: number,
  ): Promise<CampaignCommonStatsResult>;
  sendEmail(params: {
    email: string;
    senderName: string;
    senderEmail: string;
    subject: string;
    body: string;
    listId?: number;
  }): Promise<{ email: string }>;
}

function toBody(apiKey: string, params: UnisenderParams): URLSearchParams {
  const body = new URLSearchParams();
  body.set("api_key", apiKey);
  body.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item === undefined) return;
        if (Array.isArray(item)) {
          // Строка importContacts.data — индекс обязателен, иначе сервер не
          // сможет сгруппировать значения обратно по строкам: data[0][]=v1&data[0][]=v2, data[1][]=…
          for (const cell of item) {
            if (cell !== undefined)
              body.append(`${key}[${index}][]`, String(cell));
          }
        } else {
          body.append(`${key}[]`, String(item));
        }
      });
    } else {
      body.set(key, String(value));
    }
  }
  return body;
}

/** REST-клиент Unisender API. API-ключ приходит из БД (unisender_settings), не из env. */
export function createUnisenderClient(apiKey: string): UnisenderClient {
  async function call<T>(method: string, params: UnisenderParams = {}) {
    const res = await fetch(`${API_BASE}/${method}?format=json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: toBody(apiKey, params),
    });
    const json = (await res.json()) as RawResponse;
    return unwrap<T>(json, method);
  }

  return {
    async getTemplates() {
      const result = await call<{ templates?: UnisenderTemplate[] } | UnisenderTemplate[]>(
        "getTemplates",
      );
      return Array.isArray(result) ? result : (result.templates ?? []);
    },

    getTemplate(templateId) {
      return call<UnisenderTemplateDetails>("getTemplate", {
        template_id: templateId,
      });
    },

    createList(title) {
      return call<CreateListResult>("createList", { title });
    },

    importContacts({ fieldNames, data, listIds, doubleOptin = 0 }) {
      return call<ImportContactsResult>("importContacts", {
        field_names: fieldNames,
        data,
        list_ids: listIds,
        double_optin: doubleOptin,
        overwrite_lists: 1,
      });
    },

    createEmailMessage({
      senderName,
      senderEmail,
      subject,
      templateId,
      listId,
      generateText = true,
    }) {
      return call<CreateEmailMessageResult>("createEmailMessage", {
        sender_name: senderName,
        sender_email: senderEmail,
        subject,
        template_id: templateId,
        list_id: listId,
        generate_text: generateText ? 1 : 0,
      });
    },

    createCampaign({ messageId, trackRead = true, trackLinks = true }) {
      return call<CreateCampaignResult>("createCampaign", {
        message_id: messageId,
        track_read: trackRead ? 1 : 0,
        track_links: trackLinks ? 1 : 0,
      });
    },

    getCampaignStatus(campaignId) {
      return call<CampaignStatusResult>("getCampaignStatus", {
        campaign_id: campaignId,
      });
    },

    getCampaignCommonStats(campaignId) {
      return call<CampaignCommonStatsResult>("getCampaignCommonStats", {
        campaign_id: campaignId,
      });
    },

    sendEmail({ email, senderName, senderEmail, subject, body, listId }) {
      return call<{ email: string }>("sendEmail", {
        email,
        sender_name: senderName,
        sender_email: senderEmail,
        subject,
        body,
        list_id: listId,
      });
    },
  };
}
