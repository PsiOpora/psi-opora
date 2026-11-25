import {
	getPaymentProduct,
	getPaymentSettings,
	listPaymentProducts,
	upsertPaymentProduct,
	upsertPaymentSettings,
} from "@psi-opora/db/queries";
import { Hono } from "hono";
import { KIND, parseRubles, rub } from "./format";
import { Badge, Layout } from "./layout";

export const catalogPages = new Hono();

const optionalInt = (v: unknown): number | null => {
	const n = Number(String(v ?? "").trim());
	return Number.isInteger(n) && n > 0 ? n : null;
};

catalogPages.get("/products", async (c) => {
	const [products, editing] = await Promise.all([
		listPaymentProducts(),
		c.req.query("edit")
			? getPaymentProduct(c.req.query("edit") as string)
			: null,
	]);
	return c.html(
		<Layout title="Каталог" active="products">
			<h1>Каталог пакетов и курсов</h1>
			{products.length === 0 ? (
				<div class="empty">Каталог пуст — добавьте первый продукт ниже</div>
			) : (
				<table>
					<thead>
						<tr>
							<th>Название</th>
							<th>Тип</th>
							<th>Сессий</th>
							<th>Срок, дн.</th>
							<th>Статус</th>
							<th class="num">Цена</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{products.map((p) => (
							<tr>
								<td>
									{p.name} <span class="muted mono">{p.id}</span>
								</td>
								<td>{KIND[p.kind] ?? p.kind}</td>
								<td>{p.sessionsCount ?? "—"}</td>
								<td>{p.validDays ?? "—"}</td>
								<td>
									<Badge
										tone={p.active ? "ok" : "gray"}
										text={p.active ? "Продаётся" : "Скрыт"}
									/>
								</td>
								<td class="num">{rub(p.priceKopecks)}</td>
								<td>
									<a href={`/ui/products?edit=${encodeURIComponent(p.id)}`}>
										Изменить
									</a>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<h2>{editing ? `Изменить: ${editing.name}` : "Новый продукт"}</h2>
			<form method="post" action="/ui/products" class="row">
				<label>
					Код (латиницей)
					<input
						name="id"
						value={editing?.id ?? ""}
						readonly={Boolean(editing)}
						pattern="[a-z0-9\-]+"
						required
					/>
				</label>
				<label>
					Тип
					<select name="kind">
						<option value="package" selected={editing?.kind !== "course"}>
							Пакет
						</option>
						<option value="course" selected={editing?.kind === "course"}>
							Курс
						</option>
					</select>
				</label>
				<label>
					Название
					<input name="name" value={editing?.name ?? ""} required />
				</label>
				<label>
					Цена, ₽
					<input
						class="sm"
						name="price"
						value={editing ? String(editing.priceKopecks / 100) : ""}
						required
					/>
				</label>
				<label>
					Сессий
					<input
						class="sm"
						name="sessionsCount"
						value={editing?.sessionsCount ?? ""}
					/>
				</label>
				<label>
					Срок, дней
					<input class="sm" name="validDays" value={editing?.validDays ?? ""} />
				</label>
				<label>
					<span>
						<input
							type="checkbox"
							name="active"
							value="1"
							checked={editing ? editing.active : true}
							style="min-width:0"
						/>{" "}
						Продаётся
					</span>
				</label>
				<button type="submit">Сохранить</button>
			</form>
		</Layout>,
	);
});

catalogPages.post("/products", async (c) => {
	const body = await c.req.parseBody();
	const id = String(body.id ?? "").trim();
	const name = String(body.name ?? "").trim();
	const price = parseRubles(String(body.price ?? ""));
	if (!/^[a-z0-9-]+$/.test(id) || !name || price === null || price <= 0) {
		return c.text("Проверьте код, название и цену", 400);
	}
	await upsertPaymentProduct({
		id,
		kind: body.kind === "course" ? "course" : "package",
		name,
		priceKopecks: price,
		sessionsCount: optionalInt(body.sessionsCount),
		validDays: optionalInt(body.validDays),
		active: body.active === "1",
	});
	return c.redirect("/ui/products");
});

const SETTING_FIELDS = [
	[
		"contactTotalField",
		"Поле контакта «Всего оплачено»",
		"UF_CRM_…, тип «Число»",
	],
	[
		"contactLastPaidField",
		"Поле контакта «Дата последней оплаты»",
		"UF_CRM_…, тип «Дата/время»",
	],
	["dealPaidField", "Поле сделки «Оплачено»", "UF_CRM_…, тип «Число»"],
	[
		"dealPaidStageId",
		"Стадия сделки после полной оплаты",
		"STAGE_ID, например C1:WON",
	],
] as const;

catalogPages.get("/settings", async (c) => {
	const settings = await getPaymentSettings();
	return c.html(
		<Layout title="Настройки" active="settings">
			<h1>Настройки Bitrix24</h1>
			<p class="muted">
				Коды полей создаются в Bitrix24 (CRM → Настройки → Пользовательские
				поля). Пустое поле — в Bitrix ничего не записывается, остаётся только
				комментарий в таймлайне.
			</p>
			<form method="post" action="/ui/settings" class="row">
				{SETTING_FIELDS.map(([name, label, hint]) => (
					<label>
						{label}
						<input
							name={name}
							value={settings?.[name] ?? ""}
							placeholder={hint}
							style="min-width:260px"
						/>
					</label>
				))}
				<button type="submit">Сохранить</button>
			</form>
		</Layout>,
	);
});

catalogPages.post("/settings", async (c) => {
	const body = await c.req.parseBody();
	const value = (key: string): string | null => {
		const v = String(body[key] ?? "").trim();
		return v || null;
	};
	await upsertPaymentSettings({
		contactTotalField: value("contactTotalField"),
		contactLastPaidField: value("contactLastPaidField"),
		dealPaidField: value("dealPaidField"),
		dealPaidStageId: value("dealPaidStageId"),
	});
	return c.redirect("/ui/settings");
});
