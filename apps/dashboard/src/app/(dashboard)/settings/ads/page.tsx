import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { saveAdCredentialsAction } from "./actions";
import { orpc } from "@/lib/orpc-client";

export default async function AdSettingsPage() {
  const creds = await orpc.ads.getCredentials().catch(() => null);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Настройки рекламы</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Введите ключи из рекламных кабинетов.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Яндекс Директ</CardTitle>
          <CardDescription>
            Создайте приложение в{" "}
            <a
              href="https://oauth.yandex.ru/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Яндекс OAuth
            </a>{" "}
            и получите refresh_token через ручной OAuth-флоу.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={saveAdCredentialsAction}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="yandexClientId"
                  className="text-xs text-muted-foreground"
                >
                  Client ID
                </Label>
                <Input
                  id="yandexClientId"
                  name="yandexClientId"
                  defaultValue={creds?.yandexClientId ?? ""}
                  placeholder="abc123def456"
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="yandexClientSecret"
                  className="text-xs text-muted-foreground"
                >
                  Client Secret
                </Label>
                <Input
                  id="yandexClientSecret"
                  name="yandexClientSecret"
                  type="password"
                  defaultValue={creds?.yandexClientSecret ?? ""}
                  placeholder="••••••••"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="yandexRefreshToken"
                className="text-xs text-muted-foreground"
              >
                Refresh Token
              </Label>
              <Input
                id="yandexRefreshToken"
                name="yandexRefreshToken"
                type="password"
                defaultValue={creds?.yandexRefreshToken ?? ""}
                placeholder="••••••••"
                className="font-mono text-sm"
              />
            </div>

            <Separator />

            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-medium">VK Реклама</h3>
              <p className="text-sm text-muted-foreground">
                Получите токен в{" "}
                <a
                  href="https://ads.vk.com/hq/settings"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  кабинете VK Реклама
                </a>
                {" "}(раздел Настройки → Доступ к API).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="vkAccessToken"
                  className="text-xs text-muted-foreground"
                >
                  Access Token
                </Label>
                <Input
                  id="vkAccessToken"
                  name="vkAccessToken"
                  type="password"
                  defaultValue={creds?.vkAccessToken ?? ""}
                  placeholder="••••••••"
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="vkAdsAccountId"
                  className="text-xs text-muted-foreground"
                >
                  Ads Account ID
                </Label>
                <Input
                  id="vkAdsAccountId"
                  name="vkAdsAccountId"
                  defaultValue={creds?.vkAdsAccountId ?? ""}
                  placeholder="123456789"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {creds?.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Сохранено: {creds.updatedAt.toLocaleString("ru-RU")}
              </p>
            )}

            <Button type="submit" className="self-start">
              Сохранить
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
