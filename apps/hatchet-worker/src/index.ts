import { dispatchDueScheduledMessages } from "@psi-opora/api";
import {
	setScheduledMessagesDispatcher,
	startHatchetWorker,
} from "@psi-opora/jobs";
import { initTelemetry } from "@psi-opora/telemetry";

initTelemetry("hatchet-worker");

// Отложенные сообщения отправляет код из @psi-opora/api (тот же, что и у
// обычной отправки из инбокса/вкладки CRM) — jobs сам api импортировать не
// может: api зависит от jobs.
setScheduledMessagesDispatcher(async () => ({
	...(await dispatchDueScheduledMessages()),
}));

await startHatchetWorker();
