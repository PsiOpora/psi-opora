export interface BotConnectorView {
  messenger: "telegram" | "max";
  openLineId: string;
  webhookConfigured: boolean;
  updatedAt: string;
}
