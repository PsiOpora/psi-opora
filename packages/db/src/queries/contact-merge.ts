/**
 * Планирование импорта в список контактов без дублей. Контакт в списке
 * уникален и по телефону, и по email: строка импорта, совпавшая с уже
 * существующим контактом хотя бы по одному из них, дополняет его (заполняет
 * пустой телефон/email, обновляет имя), а не создаёт второй. Если строка
 * связывает два разных контакта (телефон у одного, email у другого) и их
 * данные не противоречат друг другу — контакты склеиваются в один.
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

/** Склейка существующих контактов: absorbedIds удаляются, keep получает итоговые данные. */
export interface ContactMerge {
	keep: ExistingContact;
	absorbedIds: string[];
}

export interface ContactMergePlan {
	inserts: Array<{
		email: string | null;
		phone: string | null;
		name: string | null;
	}>;
	/** Существующие контакты, у которых что-то поменялось — полные новые значения. */
	updates: ExistingContact[];
	/** Существующие контакты, которые надо слить в один (см. ContactMerge). */
	merges: ContactMerge[];
	/** Строки, совпавшие с существующим контактом списка. */
	matchedExisting: number;
	/** Строки, склеенные с другой строкой этого же импорта. */
	duplicatesInBatch: number;
	/**
	 * Строки, данные которых противоречат списку: у найденного контакта уже
	 * другой телефон/email, или телефон и email принадлежат двум контактам с
	 * несовместимыми данными. Противоречащее значение не записывается — дубль
	 * важнее потерять, чем создать.
	 */
	conflicts: number;
}

interface WorkingContact {
	existingId: string | null;
	email: string | null;
	phone: string | null;
	name: string | null;
	changed: boolean;
	/** Слит в другой контакт этого же плана. */
	absorbed: boolean;
	/** ID существующих контактов, слитых в этот. */
	absorbedIds: string[];
}

/** Два контакта можно слить, только если их телефоны и email не противоречат. */
function compatible(a: WorkingContact, b: WorkingContact): boolean {
	return (
		(!a.email || !b.email || a.email === b.email) &&
		(!a.phone || !b.phone || a.phone === b.phone)
	);
}

export function planContactMerge(
	existing: ExistingContact[],
	incoming: MergeContactInput[],
): ContactMergePlan {
	const byEmail = new Map<string, WorkingContact>();
	const byPhone = new Map<string, WorkingContact>();
	const created: WorkingContact[] = [];
	const existingWorking: WorkingContact[] = [];

	for (const contact of existing) {
		const working: WorkingContact = {
			existingId: contact.id,
			email: contact.email,
			phone: contact.phone,
			name: contact.name,
			changed: false,
			absorbed: false,
			absorbedIds: [],
		};
		existingWorking.push(working);
		if (working.email) byEmail.set(working.email, working);
		if (working.phone) byPhone.set(working.phone, working);
	}

	const plan: ContactMergePlan = {
		inserts: [],
		updates: [],
		merges: [],
		matchedExisting: 0,
		duplicatesInBatch: 0,
		conflicts: 0,
	};

	/** Переносит данные drop в keep и перенаправляет на keep индексы drop. */
	const absorb = (keep: WorkingContact, drop: WorkingContact) => {
		keep.email ??= drop.email;
		keep.phone ??= drop.phone;
		keep.name ??= drop.name;
		keep.changed = true;
		if (drop.existingId) keep.absorbedIds.push(drop.existingId);
		keep.absorbedIds.push(...drop.absorbedIds);
		drop.absorbed = true;
		if (keep.email) byEmail.set(keep.email, keep);
		if (keep.phone) byPhone.set(keep.phone, keep);
	};

	for (const row of incoming) {
		const email = row.email || null;
		const phone = row.phone || null;
		const name = row.name?.trim() || null;
		if (!email && !phone) continue;

		const byPhoneMatch = phone ? byPhone.get(phone) : undefined;
		const byEmailMatch = email ? byEmail.get(email) : undefined;
		let target = byPhoneMatch ?? byEmailMatch;

		if (!target) {
			const working: WorkingContact = {
				existingId: null,
				email,
				phone,
				name,
				changed: true,
				absorbed: false,
				absorbedIds: [],
			};
			created.push(working);
			if (email) byEmail.set(email, working);
			if (phone) byPhone.set(phone, working);
			continue;
		}

		if (target.existingId) plan.matchedExisting++;
		else plan.duplicatesInBatch++;

		let conflict = false;
		if (byPhoneMatch && byEmailMatch && byPhoneMatch !== byEmailMatch) {
			if (compatible(byPhoneMatch, byEmailMatch)) {
				// Строка доказывает, что это один человек. Оставляем уже
				// существующий контакт (его ID мог попасть в отчёты рассылок).
				const keep =
					byPhoneMatch.existingId || !byEmailMatch.existingId
						? byPhoneMatch
						: byEmailMatch;
				absorb(keep, keep === byPhoneMatch ? byEmailMatch : byPhoneMatch);
				target = keep;
			} else {
				conflict = true;
			}
		}

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
	}

	for (const working of created) {
		if (working.absorbed) continue;
		plan.inserts.push({
			email: working.email,
			phone: working.phone,
			name: working.name,
		});
	}
	for (const working of existingWorking) {
		if (working.absorbed || !working.changed) continue;
		const contact: ExistingContact = {
			id: working.existingId as string,
			email: working.email,
			phone: working.phone,
			name: working.name,
		};
		if (working.absorbedIds.length > 0) {
			plan.merges.push({ keep: contact, absorbedIds: working.absorbedIds });
		} else {
			plan.updates.push(contact);
		}
	}
	return plan;
}
