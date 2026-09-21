"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@psi-opora/api";
import {
  type AdCredentialsInput,
  adCredentialsSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { blankToUndefined } from "@/lib/blank-to-undefined";
import { orpc } from "@/lib/orpc/client";

type AdCredentials = RouterOutputs["ads"]["getCredentials"];

function toFormValues(creds: AdCredentials): AdCredentialsInput {
  return {
    yandexClientId: creds?.yandexClientId ?? "",
    yandexClientSecret: creds?.yandexClientSecret ?? "",
    yandexRefreshToken: creds?.yandexRefreshToken ?? "",
  };
}

export function AdCredentialsForm({
  initialCredentials,
}: {
  initialCredentials: AdCredentials;
}) {
  const queryClient = useQueryClient();
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showRefreshToken, setShowRefreshToken] = useState(false);

  const { data: creds } = useQuery(
    orpc.ads.getCredentials.queryOptions({
      initialData: initialCredentials,
    }),
  );

  const form = useForm<AdCredentialsInput>({
    resolver: zodResolver(adCredentialsSchema),
    defaultValues: toFormValues(initialCredentials),
  });

  const mutation = useMutation(
    orpc.ads.upsertCredentials.mutationOptions({
      onSuccess: () => {
        toast.success("Настройки рекламы сохранены");
        // Сбрасывает флаг "изменено" формы, оставляя введённые значения как есть
        // (не значения с undefined, отправленные на сервер вместо пустых полей).
        form.reset(form.getValues());
        queryClient.invalidateQueries({
          queryKey: orpc.ads.getCredentials.key(),
        });
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось сохранить настройки");
      },
    }),
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          mutation.mutate(blankToUndefined(values)),
        )}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="yandexClientId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Client ID
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="abc123def456"
                    className="font-mono text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="yandexClientSecret"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Client Secret
                </FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showClientSecret ? "text" : "password"}
                      placeholder="••••••••"
                      className="font-mono text-sm pr-10"
                      {...field}
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowClientSecret((prev) => !prev)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showClientSecret
                        ? "Hide client secret"
                        : "Show client secret"
                    }
                    aria-pressed={showClientSecret}
                  >
                    {showClientSecret ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="yandexRefreshToken"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                Refresh Token
              </FormLabel>
              <div className="relative">
                <FormControl>
                  <Input
                    type={showRefreshToken ? "text" : "password"}
                    placeholder="••••••••"
                    className="font-mono text-sm pr-10"
                    {...field}
                  />
                </FormControl>
                <button
                  type="button"
                  onClick={() => setShowRefreshToken((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  aria-label={
                    showRefreshToken
                      ? "Hide refresh token"
                      : "Show refresh token"
                  }
                  aria-pressed={showRefreshToken}
                >
                  {showRefreshToken ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            Как получить Refresh Token для Яндекс.Директа
          </p>
          <p className="mt-1">
            Подробная инструкция «для чайника», с пояснением каждого шага и
            отдельными командами для Windows и macOS/Linux —{" "}
            <a
              href="https://github.com/PsiOpora/psi-opora/blob/main/docs/yandex-direct-refresh-token.md"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              docs/yandex-direct-refresh-token.md
            </a>
            . Коротко суть — ниже.
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            <li>
              Зайдите в{" "}
              <a
                href="https://oauth.yandex.ru/client/new"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                oauth.yandex.ru/client/new
              </a>{" "}
              и создайте приложение (или откройте уже существующее в{" "}
              <a
                href="https://oauth.yandex.ru/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                списке приложений
              </a>
              ) под учёткой Яндекса, у которой есть доступ к вашим рекламным
              кабинетам Директа.
            </li>
            <li>
              В разделе «Платформы» выберите «Веб-сервисы» и в поле Redirect URI
              вставьте без изменений:
              <br />
              <code className="mt-1 block break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">
                https://oauth.yandex.ru/verification_code
              </code>
            </li>
            <li>
              В разделе «Доступ к данным» найдите в поиске «Директ» и отметьте
              право{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                direct:api
              </code>
              .
            </li>
            <li>
              Сохраните приложение — откроются два значения, <b>ClientID</b> и{" "}
              <b>Client Secret</b> (это уже секрет, никому не показывайте).
              Скопируйте оба в поля выше.
            </li>
            <li>
              Подставьте свой ClientID вместо{" "}
              <code className="font-mono">ВАШ_CLIENT_ID</code> и откройте ссылку
              в браузере (под той же учёткой Яндекса):
              <br />
              <code className="mt-1 block break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">
                https://oauth.yandex.ru/authorize?response_type=code&client_id=ВАШ_CLIENT_ID
              </code>
            </li>
            <li>
              Нажмите «Разрешить» — откроется страница с одноразовым кодом
              подтверждения. Скопируйте его (код живёт всего пару минут; не
              успели — откройте ссылку ещё раз).
            </li>
            <li>
              Обменяйте код на токены запросом. В bash/macOS/Linux и в cmd.exe
              команда одинаковая:
              <br />
              <code className="mt-1 block break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">
                curl -X POST https://oauth.yandex.ru/token -d
                "grant_type=authorization_code&code=КОД&client_id=ВАШ_CLIENT_ID&client_secret=ВАШ_CLIENT_SECRET"
              </code>
              В PowerShell{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                curl
              </code>{" "}
              — это алиас <code className="font-mono">Invoke-WebRequest</code> с
              другими параметрами, поэтому используйте:
              <br />
              <code className="mt-1 block break-all rounded bg-muted px-1 py-0.5 font-mono text-xs whitespace-pre-wrap">
                {
                  'Invoke-RestMethod -Method Post -Uri "https://oauth.yandex.ru/token" -Body @{ grant_type="authorization_code"; code="КОД"; client_id="ВАШ_CLIENT_ID"; client_secret="ВАШ_CLIENT_SECRET" }'
                }
              </code>{" "}
              (или явно вызовите <code className="font-mono">curl.exe</code> с
              той же командой, что и выше). Подробнее — в файле
              docs/yandex-direct-refresh-token.md в репозитории. (обычный{" "}
              <code className="font-mono">curl</code> в PowerShell — это не то
              же самое, что curl в bash, поэтому команды разные — подробности в
              файле-инструкции по ссылке выше).
            </li>
            <li>
              В ответе будет поле{" "}
              <code className="font-mono">refresh_token</code> — скопируйте его
              целиком в поле выше и сохраните. Значение{" "}
              <code className="font-mono">access_token</code> из того же ответа
              никуда сохранять не нужно — сервис сам получает свежий
              access-токен по refresh-токену перед каждым запросом к Директу.
            </li>
          </ol>
          <p className="mt-2">, повторите шаги 5–8.</p>
        </div>

        {creds?.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Сохранено: {new Date(creds.updatedAt).toLocaleString("ru-RU")}
          </p>
        )}

        <Button
          type="submit"
          disabled={mutation.isPending}
          className="self-start"
        >
          {mutation.isPending ? "Сохраняем…" : "Сохранить"}
        </Button>
      </form>
    </Form>
  );
}
