/**
 * Планирование импорта в список контактов без дублей. Контакт в списке
 * уникален и по телефону, и по email: строка импорта, совпавшая с уже
 * существующим контактом хотя бы по одному из них, дополняет его (заполняет
 * пустой телефон/email, обновляет имя), а не создаёт второй.
 *
 * Чистая функция — без БД, чтобы покрыть тестами все случаи склейки.
 */

export interface MergeContactInput {
	/** Уже нормализованные значения (см. normalizeEmail / normalizePhone). */
	email?: string | null;
	phone?: string | null;
	name?: string | null;
}

export interface ExistingContact {
	id: string;
	email: string | null;
	phone: string | null;
	name: string | null;
}

export interface ContactMergePlan {
	inserts: Array<{
		email: string | null;
		phone: string | null;
		name: string | null;
	}>;
	/** Существующие контакты, у которых что-то поменялось — полные новые значения. */
	updates: ExistingContact[];
	/** Строки, совпавшие с существующим контактом списка. */
	matchedExisting: number;
	/** Строки, склеенные с другой строкой этого же импорта. */
	duplicatesInBatch: number;
	/**
	 * Строки, данные которых противоречат списку: телефон у одного контакта,
	 * email у другого, или у найденного контакта уже другой телефон/email.
	 * Противоречащее значение не записывается — дубль важнее потерять, чем создать.
	 */
	conflicts: number;
}

interface WorkingContact {
	existingId: string | null;
	email: string | null;
	phone: string | null;
	name: string | null;
	changed: boolean;
}

export function planContactMerge(
	existing: ExistingContact[],
	incoming: MergeContactInput[],
): ContactMergePlan {
	const byEmail = new Map<string, WorkingContact>();
	const byPhone = new Map<string, WorkingContact>();
	const created: WorkingContact[] = [];
	const touched = new Set<WorkingContact>();

	for (const contact of existing) {
		const working: WorkingContact = {
			existingId: contact.id,
			email: contact.email,
			phone: contact.phone,
			name: contact.name,
			changed: false,
		};
		if (working.email) byEmail.set(working.email, working);
		if (working.phone) byPhone.set(working.phone, working);
	}

	const plan: ContactMergePlan = {
		inserts: [],
		updates: [],
		matchedExisting: 0,
		duplicatesInBatch: 0,
		conflicts: 0,
	};

	for (const row of incoming) {
		const email = row.email || null;
		const phone = row.phone || null;
		const name = row.name?.trim() || null;
		if (!email && !phone) continue;

		const byPhoneMatch = phone ? byPhone.get(phone) : undefined;
		const byEmailMatch = email ? byEmail.get(email) : undefined;
		const target = byPhoneMatch ?? byEmailMatch;

		if (!target) {
			const working: WorkingContact = {
				existingId: null,
				email,
				phone,
				name,
				changed: true,
			};
			created.push(working);
			if (email) byEmail.set(email, working);
			if (phone) byPhone.set(phone, working);
			continue;
		}

		if (target.existingId) plan.matchedExisting++;
		else plan.duplicatesInBatch++;

		let conflict = Boolean(
			byPhoneMatch && byEmailMatch && byPhoneMatch !== byEmailMatch,
		);
		if (phone && target.phone !== phone) {
			if (target.phone || byPhone.has(phone)) conflict = true;
			else {
				target.phone = phone;
				byPhone.set(phone, target);
				target.changed = true;
			}
		}
		if (email && target.email !== email) {
			if (target.email || byEmail.has(email)) conflict = true;
			else {
				target.email = email;
				byEmail.set(email, target);
				target.changed = true;
			}
		}
		if (name && target.name !== name) {
			target.name = name;
			target.changed = true;
		}
		if (conflict) plan.conflicts++;
		if (target.existingId && target.changed) touched.add(target);
	}

	for (const working of created) {
		plan.inserts.push({
			email: working.email,
			phone: working.phone,
			name: working.name,
		});
	}
	for (const working of touched) {
		plan.updates.push({
			id: working.existingId as string,
			email: working.email,
			phone: working.phone,
			name: working.name,
		});
	}
	return plan;
}
