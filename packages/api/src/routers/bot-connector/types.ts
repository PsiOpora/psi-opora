export interface BotConnectorView {
  messenger: "telegram" | "max";
  openLineId: string;
  webhookConfigured: boolean;
  hasToken: boolean;
  updatedAt: string;
}
