"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@psi-opora/api";
import {
  type BackupCredentialsInput,
  backupCredentialsSchema,
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
import { blankToUndefined } from "@/lib/blank-to-undefined";
import { orpc } from "@/lib/orpc/client";

type BackupCredentials = RouterOutputs["backup"]["getCredentials"];

function toFormValues(creds: BackupCredentials): BackupCredentialsInput {
  return {
    s3Endpoint: creds?.s3Endpoint ?? "",
    s3Region: creds?.s3Region ?? "ru-central1",
    s3Bucket: creds?.s3Bucket ?? "",
    s3AccessKeyId: creds?.s3AccessKeyId ?? "",
    s3SecretAccessKey: creds?.s3SecretAccessKey ?? "",
  };
}

export function BackupCredentialsForm({
  initialCredentials,
}: {
  initialCredentials: BackupCredentials;
}) {
  const queryClient = useQueryClient();

  const { data: creds } = useQuery(
    orpc.backup.getCredentials.queryOptions({
      initialData: initialCredentials,
    }),
  );

  const form = useForm<BackupCredentialsInput>({
    resolver: zodResolver(backupCredentialsSchema),
    defaultValues: toFormValues(initialCredentials),
  });

  const mutation = useMutation(
    orpc.backup.upsertCredentials.mutationOptions({
      onSuccess: () => {
        toast.success("Настройки S3 сохранены");
        form.reset(form.getValues());
        queryClient.invalidateQueries({
          queryKey: orpc.backup.getCredentials.key(),
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
            name="s3Endpoint"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Endpoint
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="https://storage.yandexcloud.net"
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
            name="s3Region"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Регион
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="ru-central1"
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
          name="s3Bucket"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                Бакет
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="psi-opora-crm-backups"
                  className="font-mono text-sm"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="s3AccessKeyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Access Key ID
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="YCAJE..."
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
            name="s3SecretAccessKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Secret Access Key
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
