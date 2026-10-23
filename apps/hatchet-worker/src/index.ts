import { startHatchetWorker } from "@psi-opora/jobs";
import { initTelemetry } from "@psi-opora/telemetry";

initTelemetry("hatchet-worker");

await startHatchetWorker();
