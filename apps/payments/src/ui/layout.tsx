import { raw } from "hono/html";
import type { FC, PropsWithChildren } from "hono/jsx";

const CSS = `
:root { --bg:#f6f7f9; --card:#fff; --text:#1c2230; --muted:#667085; --line:#e4e7ec;
  --accent:#2f5bea; --ok:#067647; --ok-bg:#ecfdf3; --warn:#b54708; --warn-bg:#fffaeb;
  --bad:#b42318; --bad-bg:#fef3f2; }
* { box-sizing:border-box; }
body { margin:0; font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--text); }
header { background:var(--card); border-bottom:1px solid var(--line); padding:0 24px; display:flex; gap:24px; align-items:center; height:52px; }
header .brand { font-weight:600; }
header nav { display:flex; gap:4px; flex:1; }
header nav a { padding:6px 12px; border-radius:6px; color:var(--muted); text-decoration:none; }
header nav a.active, header nav a:hover { background:var(--bg); color:var(--text); }
main { max-width:1100px; margin:24px auto; padding:0 24px; }
h1 { font-size:20px; margin:0 0 16px; }
h2 { font-size:15px; margin:28px 0 10px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin-bottom:8px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.card .label { color:var(--muted); font-size:12px; }
.card .value { font-size:22px; font-weight:600; margin-top:2px; }
table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:12px; color:var(--muted); font-weight:500; background:#fafbfc; }
tr:last-child td { border-bottom:none; }
td.num, th.num { text-align:right; white-space:nowrap; }
.muted { color:var(--muted); }
.badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; }
.badge.ok { background:var(--ok-bg); color:var(--ok); }
.badge.warn { background:var(--warn-bg); color:var(--warn); }
.badge.bad { background:var(--bad-bg); color:var(--bad); }
.badge.gray { background:var(--bg); color:var(--muted); }
form.inline { display:inline; }
form.row { display:flex; gap:8px; flex-wrap:wrap; align-items:end; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; }
label { display:flex; flex-direction:column; gap:3px; font-size:12px; color:var(--muted); }
input, select { font:inherit; padding:6px 9px; border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--text); min-width:140px; }
input.sm { min-width:90px; width:110px; }
button { font:inherit; padding:7px 14px; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:6px; cursor:pointer; }
button.secondary { background:#fff; color:var(--text); border-color:var(--line); }
a { color:var(--accent); }
.notice { background:var(--warn-bg); color:var(--warn); border-radius:8px; padding:10px 14px; margin-bottom:16px; }
.empty { color:var(--muted); padding:18px; text-align:center; background:var(--card); border:1px solid var(--line); border-radius:10px; }
.login { max-width:340px; margin:15vh auto; }
code, .mono { font-family:ui-monospace,Consolas,monospace; font-size:13px; word-break:break-all; }
`;

const NAV: [string, string, string][] = [
	["home", "/ui", "Сводка"],
	["payments", "/ui/payments", "Оплаты"],
	["unmatched", "/ui/unmatched", "Не разобрано"],
	["clients", "/ui/clients", "Клиенты"],
	["products", "/ui/products", "Каталог"],
	["settings", "/ui/settings", "Настройки"],
];

export const Layout: FC<
	PropsWithChildren<{ title: string; active?: string; bare?: boolean }>
> = ({ title, active, bare, children }) => (
	<html lang="ru">
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>{title} — Оплаты</title>
			<style>{raw(CSS)}</style>
		</head>
		<body>
			{!bare && (
				<header>
					<span class="brand">Пси-Опора · Оплаты</span>
					<nav>
						{NAV.map(([key, href, label]) => (
							<a href={href} class={active === key ? "active" : ""}>
								{label}
							</a>
						))}
					</nav>
					<form method="post" action="/ui/logout" class="inline">
						<button type="submit" class="secondary">
							Выйти
						</button>
					</form>
				</header>
			)}
			<main>{children}</main>
		</body>
	</html>
);

export const Badge: FC<{
	tone: "ok" | "warn" | "bad" | "gray";
	text: string;
}> = ({ tone, text }) => <span class={`badge ${tone}`}>{text}</span>;

export const ContactLink: FC<{
	id: string | null;
	names: Map<string, string>;
}> = ({ id, names }) =>
	id ? (
		<a href={`/ui/clients/${id}`}>{names.get(id) ?? `Контакт ${id}`}</a>
	) : (
		<span class="muted">—</span>
	);
