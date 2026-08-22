import {
	DASHBOARD_SESSION_COOKIE,
	verifyBitrixSessionToken,
} from "@psi-opora/bitrix-client";
import { FUNNEL_STEPS } from "@psi-opora/bot-core";
import { getBotFunnelStepClients } from "@psi-opora/db/queries";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { formatDateParam } from "@/lib/analytics/date-range";

export const dynamic = "force-dynamic";

const VALID_FLOWS = ["consult", "guide", "-"] as const;
const VALID_REASONS = [
	"declined",
	"phone_skipped",
	"phone_invalid_exhausted",
	"phone_invalid",
	"email_invalid",
	"timeout",
	"blocked",
	"send_failed",
] as const;

const flowSchema = z.enum(VALID_FLOWS);
const reasonSchema = z.enum(VALID_REASONS);

/** Список уникальных клиентов, дошедших до шага воронки бота — drill-down по
 * клику на число в отчёте (см. /bot-funnel и FunnelChart.stepHref). */
export async function GET(request: Request) {
	const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
	const session = verifyBitrixSessionToken(token, "dashboard");
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const step = url.searchParams.get("step");
	if (!step || !(FUNNEL_STEPS as readonly string[]).includes(step)) {
		return NextResponse.json(
			{ error: "Некорректный шаг воронки" },
			{ status: 400 },
		);
	}

	const toParam = url.searchParams.get("to");
	const fromParam = url.searchParams.get("from");
	const to = toParam ? new Date(toParam) : new Date();
	const from = fromParam
		? new Date(fromParam)
		: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

	if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) {
		return NextResponse.json(
			{ error: "Некорректная дата (from или to)" },
			{ status: 400 },
		);
	}

	const messenger = url.searchParams.get("messenger") || undefined;
	const source = url.searchParams.get("source") || undefined;
	const campaign = url.searchParams.get("campaign") || undefined;

	const flowParam = url.searchParams.get("flow");
	let flow: string | undefined;
	if (flowParam) {
		const flowResult = flowSchema.safeParse(flowParam);
		if (!flowResult.success) {
			return NextResponse.json(
				{ error: "Некорректное значение flow" },
				{ status: 400 },
			);
		}
		flow = flowResult.data;
	}

	const reasonParam = url.searchParams.get("reason");
	let reason: string | undefined;
	if (reasonParam) {
		const reasonResult = reasonSchema.safeParse(reasonParam);
		if (!reasonResult.success) {
			return NextResponse.json(
				{ error: "Некорректное значение reason" },
				{ status: 400 },
			);
		}
		reason = reasonResult.data;
	}

	const clients = await getBotFunnelStepClients({
		step,
		fromDate: formatDateParam(from),
		toDate: formatDateParam(to),
		messenger,
		source,
		campaign,
		flow,
		reason,
	});

	return NextResponse.json({ clients });
}
