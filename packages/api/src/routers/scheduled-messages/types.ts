/** Отложенное сообщение, как его видит оператор в инбоксе и во вкладке CRM. */
export interface ScheduledMessageItem {
	id: string;
	messenger: string;
	text: string;
	/** ISO-время, когда сообщение должно уйти. */
	sendAt: string;
	/** pending — ждёт; sending — уходит прямо сейчас; failed — не отправлено
	 * (причина в error). Отправленные и отменённые в список не попадают: первые
	 * уже видны в истории диалога. */
	status: "pending" | "sending" | "failed";
	error: string | null;
	operatorName: string | null;
	attachment: { fileName: string; kind: "image" | "file" | "voice" } | null;
}

export type ScheduleMessageResult =
	| { ok: true; item: ScheduledMessageItem }
	| { ok: false; error: string };
