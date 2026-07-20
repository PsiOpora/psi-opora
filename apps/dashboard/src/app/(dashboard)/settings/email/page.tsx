"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UnisenderSettingsForm } from "./settings-form";

export default function EmailSettingsPage() {
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Настройки Unisender</h1>
        <p className="text-sm text-muted-foreground mt-1">
          API-ключ и адрес отправителя для email-рассылки по стадиям сделок
          (раздел «Email-рассылка»).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unisender</CardTitle>
          <CardDescription>
            API-ключ — в личном кабинете Unisender:{" "}
            <a
              href="https://cp.unisender.com/ru/v5/user/profile/api"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Настройки → API-ключи
            </a>
            . Адрес отправителя должен быть подтверждён в Unisender (SPF/DKIM)
            — иначе письма будут попадать в спам.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UnisenderSettingsForm />
        </CardContent>
      </Card>
    </div>
  );
}
