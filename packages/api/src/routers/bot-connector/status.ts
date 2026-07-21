import { getBotConnector } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import type { BotConnectorView } from "./types";

async function toView(
  messenger: "telegram" | "max",
): Promise<BotConnectorView | null> {
  const row = await getBotConnector(messenger);
  if (!row) return null;
  return {
    messenger,
    openLineId: row.openLineId,
    webhookConfigured: !!row.webhookConfiguredAt,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Статус обоих ботов — для карточек в настройках. */
export const status = publicProcedure.handler(
  async (): Promise<{
    telegram: BotConnectorView | null;
    max: BotConnectorView | null;
  }> => {
    const [telegram, max] = await Promise.all([
      toView("telegram"),
      toView("max"),
    ]);
    return { telegram, max };
  },
);
