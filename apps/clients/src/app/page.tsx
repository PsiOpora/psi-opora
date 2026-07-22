import { InboxApp } from "@/components/inbox/inbox-app";

// Битрикс24 открывает локальное приложение во фрейме POST-запросом (передаёт
// AUTH_ID и прочее в form-data). Статически пререндеренная страница отвечает
// на POST 405 — поэтому принудительно рендерим на каждый запрос.
export const dynamic = "force-dynamic";

export default function ClientsPage() {
  return <InboxApp />;
}
