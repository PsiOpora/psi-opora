import { getUnisenderSettings } from "@psi-opora/db/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { saveUnisenderSettingsAction } from "./actions";

export default async function EmailSettingsPage() {
  const settings = await getUnisenderSettings().catch(() => null);

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
          <form
            action={saveUnisenderSettingsAction}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apiKey" className="text-xs text-muted-foreground">
                API-ключ
              </Label>
              <Input
                id="apiKey"
                name="apiKey"
                type="password"
                defaultValue={settings?.apiKey ?? ""}
                placeholder="••••••••"
                className="font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="senderEmail"
                  className="text-xs text-muted-foreground"
                >
                  Email отправителя
                </Label>
                <Input
                  id="senderEmail"
                  name="senderEmail"
                  type="email"
                  defaultValue={settings?.senderEmail ?? ""}
                  placeholder="hello@psi-opora.ru"
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="senderName"
                  className="text-xs text-muted-foreground"
                >
                  Имя отправителя
                </Label>
                <Input
                  id="senderName"
                  name="senderName"
                  defaultValue={settings?.senderName ?? ""}
                  placeholder="Психологический центр «Опора»"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {settings?.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Сохранено: {settings.updatedAt.toLocaleString("ru-RU")}
              </p>
            )}

            <SubmitButton
              action={saveUnisenderSettingsAction}
              idleLabel="Сохранить"
              successMessage="Настройки Unisender сохранены"
              className="self-start"
            />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
