"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { orpc } from "@/lib/orpc/client";
import { AutoRefresh } from "./auto-refresh";
import { BackupCredentialsForm } from "./credentials-form";
import { RunBackupButton } from "./run-backup-button";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} МБ`;
}

const STATUS_LABEL: Record<string, string> = {
  running: "Выполняется",
  success: "Успешно",
  error: "Ошибка",
};

export default function BackupSettingsPage() {
  const { data: creds } = useQuery(orpc.backup.getCredentials.queryOptions());
  const { data: runs = [] } = useQuery(orpc.backup.listRuns.queryOptions());

  const hasRunningBackup = runs.some((run) => run.status === "running");

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <AutoRefresh enabled={hasRunningBackup} />
      <div>
        <h1 className="text-2xl font-semibold">Бэкап CRM</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Регулярная выгрузка сделок, лидов, контактов, компаний и активностей
          Bitrix24 в Yandex Object Storage (S3-совместимое хранилище).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Настройки Yandex S3</CardTitle>
          <CardDescription>
            Создайте бакет и статический ключ доступа в{" "}
            <a
              href="https://console.yandex.cloud/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Yandex Cloud
            </a>{" "}
            (Object Storage → Сервисные аккаунты → Статический ключ). Endpoint
            обычно{" "}
            <code className="text-xs">https://storage.yandexcloud.net</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BackupCredentialsForm initialCredentials={creds ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Запуск бэкапа</CardTitle>
          <CardDescription>
            Бэкап выполняется фоновым заданием Hatchet — кнопка лишь ставит
            его в очередь, статус появится в таблице ниже. Ночной запуск по
            расписанию делает Vercel Cron.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RunBackupButton />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Начат</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Папка в S3</TableHead>
                <TableHead>Размер</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground"
                  >
                    Бэкапов ещё не было
                  </TableCell>
                </TableRow>
              )}
              {runs.map((run) => {
                const errors = Array.isArray(run.errors) ? run.errors : [];
                return (
                  <TableRow key={run.id}>
                    <TableCell className="text-sm">
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString("ru-RU")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {STATUS_LABEL[run.status] ?? run.status}
                      {run.status === "running" && (
                        <div className="mt-1.5 flex w-40 flex-col gap-1">
                          <Progress
                            value={
                              run.entitiesTotal
                                ? Math.round(
                                    ((run.entitiesDone ?? 0) /
                                      run.entitiesTotal) *
                                      100,
                                  )
                                : 0
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            {run.entitiesTotal
                              ? `${run.entitiesDone ?? 0} из ${run.entitiesTotal}${run.currentEntity ? ` — ${run.currentEntity}` : ""}`
                              : "Постановка в очередь…"}
                          </p>
                        </div>
                      )}
                      {run.status === "error" && run.error && (
                        <p className="text-xs text-destructive">{run.error}</p>
                      )}
                      {errors.length > 0 && (
                        <p className="text-xs text-destructive">
                          Ошибок сущностей: {errors.length}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {run.prefix ?? run.objectKey ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatBytes(run.totalBytes)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
