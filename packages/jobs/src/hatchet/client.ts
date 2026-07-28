import { HatchetClient } from "@hatchet-dev/typescript-sdk/v1";

let client: HatchetClient | undefined;

/**
 * Создаём клиент лениво: @psi-opora/jobs импортируется и во время next build,
 * когда runtime-секрет HATCHET_CLIENT_TOKEN намеренно недоступен.
 */
export function getHatchetClient(): HatchetClient {
  client ??= HatchetClient.init();
  return client;
}
