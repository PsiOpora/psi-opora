"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProviderSwitch } from "./provider-switch";
import { ResendSettingsForm } from "./resend-settings-form";
import { RusenderSettingsForm } from "./rusender-settings-form";
import { UnisenderSettingsForm } from "./settings-form";
import { SmtpBzSettingsForm } from "./smtp-bz-settings-form";

export default function EmailSettingsPage() {
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Настройки email</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Провайдер, API-ключ и адрес отправителя для email-рассылки по
            стадиям сделок (раздел «Email-рассылка») и транзакционных писем.
          </p>
        </div>
        <ProviderSwitch />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rusender</CardTitle>
          <CardDescription>
            API-ключ и key ID — в личном кабинете Rusender:{" "}
            <a
              href="https://cabinet.rusender.ru/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Интеграции → API
            </a>
            . Провайдер по умолчанию. Адрес отправителя должен принадлежать
            подтверждённому в Rusender домену — иначе письма отклоняются. Если
            письмо не удаётся отправить через Rusender, платформа
            автоматически пробует резервные провайдеры ниже — сначала SMTP.BZ,
            затем Resend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RusenderSettingsForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SMTP.BZ (резервный)</CardTitle>
          <CardDescription>
            API-ключ — в личном кабинете{" "}
            <a
              href="https://smtp.bz/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              SMTP.BZ
            </a>
            . Используется автоматически, если отправка через Rusender не
            удалась.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SmtpBzSettingsForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resend (резервный)</CardTitle>
          <CardDescription>
            API-ключ — в личном кабинете{" "}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Resend
            </a>
            . Используется автоматически, если отправка не удалась ни через
            Rusender, ни через SMTP.BZ.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResendSettingsForm />
        </CardContent>
      </Card>

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
            . Используется как источник шаблонов для email-рассылки по стадиям
            независимо от выбранного провайдера отправки, а также как
            альтернативный провайдер отправки. Адрес отправителя должен быть
            подтверждён в Unisender (SPF/DKIM) — иначе письма будут попадать в
            спам.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UnisenderSettingsForm />
        </CardContent>
      </Card>
    </div>
  );
}
