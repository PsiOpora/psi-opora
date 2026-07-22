import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientsInbox } from "./clients-inbox-client";

export default function ClientsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Клиенты</CardTitle>
        <CardDescription>
          Единый список переписки со всеми клиентами — Telegram, MAX, личный номер
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ClientsInbox />
      </CardContent>
    </Card>
  );
}
