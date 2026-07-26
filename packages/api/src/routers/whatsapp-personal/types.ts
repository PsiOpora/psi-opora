export interface WhatsappPersonalAccountView {
  lineId: string;
  connectorId: string;
  /** Замаскированный номер (видны первые 4 и последние 2 цифры). */
  phone: string;
  status: string;
  updatedAt: string;
}
