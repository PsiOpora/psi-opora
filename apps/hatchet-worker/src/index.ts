import { dispatchDueScheduledMessages } from "@psi-opora/api";
import {
	startHatchetWorker,
	startScheduledMessagesTicker,
} from "@psi-opora/jobs";
import { initTelemetry } from "@psi-opora/telemetry";

initTelemetry("hatchet-worker");

// Отложенные сообщения рассылает таймер в этом процессе, а не крон Hatchet
// (см. scheduled-messages-ticker.ts в packages/jobs). Отправляет их код из
// @psi-opora/api (тот же, что и у обычной отправки из инбокса/вкладки CRM) —
// jobs сам api импортировать не может: api зависит от jobs.
const scheduledMessages = startScheduledMessagesTicker(async (signal) => ({
	...(await dispatchDueScheduledMessages(undefined, undefined, signal)),
}));

await startHatchetWorker({ onShutdown: () => scheduledMessages.stop() });
