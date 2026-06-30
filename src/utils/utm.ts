export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

// Telegram start param: only A-Za-z0-9_- allowed, max 64 chars.
// Format: base64url( "source|medium|campaign|content|term" )
// Empty fields stay empty: "google|cpc|brand||" — always 5 pipe-separated parts.

function toBase64url(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function fromBase64url(str: string): string {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

export function parseUtmParams(startParam: string | undefined): UtmParams {
  if (!startParam) return {};

  try {
    const decoded = fromBase64url(startParam);
    const [source, medium, campaign, content, term] = decoded.split("|");
    return {
      utm_source: source || undefined,
      utm_medium: medium || undefined,
      utm_campaign: campaign || undefined,
      utm_content: content || undefined,
      utm_term: term || undefined,
    };
  } catch {
    return {};
  }
}

// Builds a correct Telegram deep link with all UTM params.
// Example result fits well under 64 chars for typical values.
export function buildStartLink(botUsername: string, params: UtmParams): string {
  const payload = [
    params.utm_source ?? "",
    params.utm_medium ?? "",
    params.utm_campaign ?? "",
    params.utm_content ?? "",
    params.utm_term ?? "",
  ].join("|");
  return `https://t.me/${botUsername}?start=${toBase64url(payload)}`;
}

export function formatUtmLog(params: UtmParams): string {
  const parts = [
    params.utm_source && `source=${params.utm_source}`,
    params.utm_medium && `medium=${params.utm_medium}`,
    params.utm_campaign && `campaign=${params.utm_campaign}`,
    params.utm_content && `content=${params.utm_content}`,
    params.utm_term && `term=${params.utm_term}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "без UTM-меток";
}
