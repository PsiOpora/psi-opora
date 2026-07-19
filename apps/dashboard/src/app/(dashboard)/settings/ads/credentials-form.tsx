"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@psi-opora/api";
import {
  type AdCredentialsInput,
  adCredentialsSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Separator } from "@/components/ui/separator";
import { orpc } from "@/lib/orpc/client";

type AdCredentials = RouterOutputs["ads"]["getCredentials"];

function toFormValues(creds: AdCredentials): AdCredentialsInput {
  return {
    yandexClientId: creds?.yandexClientId ?? "",
    yandexClientSecret: creds?.yandexClientSecret ?? "",
    yandexRefreshToken: creds?.yandexRefreshToken ?? "",
    vkAccessToken: creds?.vkAccessToken ?? "",
    vkAdsAccountId: creds?.vkAdsAccountId ?? "",
  };
}

export function AdCredentialsForm({
  initialCredentials,
}: {
  initialCredentials: AdCredentials;
}) {
  const queryClient = useQueryClient();

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
      onSuccess: (_data, values) => {
        toast.success("Настройки рекламы сохранены");
        form.reset(values);
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
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
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
                <FormControl>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    className="font-mono text-sm"
                    {...field}
                  />
                </FormControl>
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
              <FormControl>
                <Input
                  type="password"
                  placeholder="••••••••"
                  className="font-mono text-sm"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
            </a>{" "}
            (раздел Настройки → Доступ к API).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="vkAccessToken"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Access Token
                </FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="••••••••"
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
            name="vkAdsAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Ads Account ID
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="123456789"
                    className="font-mono text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
