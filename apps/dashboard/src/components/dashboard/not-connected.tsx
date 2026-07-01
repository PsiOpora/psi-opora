import { PlugZapIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function NotConnected() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugZapIcon />
        </EmptyMedia>
        <EmptyTitle>Нет подключения к Битрикс24</EmptyTitle>
        <EmptyDescription>
          Откройте приложение внутри своего портала Битрикс24, чтобы увидеть данные CRM. Для
          локальной разработки задайте DASHBOARD_BITRIX_WEBHOOK_URL в .env.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
