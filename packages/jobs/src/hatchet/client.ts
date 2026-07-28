import Hatchet from "@hatchet-dev/typescript-sdk";

let client: Hatchet | undefined;

/**
 * Создаём клиент лениво: @psi-opora/jobs импортируется и во время next build,
 * когда runtime-секрет HATCHET_CLIENT_TOKEN намеренно недоступен.
 */
export function getHatchetClient(): Hatchet {
  client ??= Hatchet.init();
  return client;
}
