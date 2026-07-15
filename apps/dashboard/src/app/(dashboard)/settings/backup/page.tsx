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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { orpc } from "@/lib/orpc-client";
import { saveBackupCredentialsAction, runBackupNowAction } from "./actions";

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

export default async function BackupSettingsPage() {
  const [creds, runs] = await Promise.all([
    orpc.backup.getCredentials().catch(() => null),
    orpc.backup.listRuns().catch(() => []),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
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
            (Object Storage → Сервисные аккаунты → Статический ключ).
            Endpoint обычно{" "}
            <code className="text-xs">
              https://storage.yandexcloud.net
            </code>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={saveBackupCredentialsAction}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="s3Endpoint"
                  className="text-xs text-muted-foreground"
                >
                  Endpoint
                </Label>
                <Input
                  id="s3Endpoint"
                  name="s3Endpoint"
                  defaultValue={creds?.s3Endpoint ?? ""}
                  placeholder="https://storage.yandexcloud.net"
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="s3Region"
                  className="text-xs text-muted-foreground"
                >
                  Регион
                </Label>
                <Input
                  id="s3Region"
                  name="s3Region"
                  defaultValue={creds?.s3Region ?? "ru-central1"}
                  placeholder="ru-central1"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="s3Bucket"
                className="text-xs text-muted-foreground"
              >
                Бакет
              </Label>
              <Input
                id="s3Bucket"
                name="s3Bucket"
                defaultValue={creds?.s3Bucket ?? ""}
                placeholder="psi-opora-crm-backups"
                className="font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="s3AccessKeyId"
                  className="text-xs text-muted-foreground"
                >
                  Access Key ID
                </Label>
                <Input
                  id="s3AccessKeyId"
                  name="s3AccessKeyId"
                  defaultValue={creds?.s3AccessKeyId ?? ""}
                  placeholder="YCAJE..."
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="s3SecretAccessKey"
                  className="text-xs text-muted-foreground"
                >
                  Secret Access Key
                </Label>
                <Input
                  id="s3SecretAccessKey"
                  name="s3SecretAccessKey"
                  type="password"
                  defaultValue={creds?.s3SecretAccessKey ?? ""}
                  placeholder="••••••••"
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

      <Card>
        <CardHeader>
          <CardTitle>Запуск бэкапа</CardTitle>
          <CardDescription>
            Бэкап также выполняется автоматически каждую ночь по расписанию
            (Vercel Cron, 03:00). Здесь можно запустить его вручную.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={runBackupNowAction}>
            <Button type="submit" variant="secondary">
              Запустить бэкап сейчас
            </Button>
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Начат</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Объект в S3</TableHead>
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
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-sm">
                    {run.startedAt
                      ? new Date(run.startedAt).toLocaleString("ru-RU")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {STATUS_LABEL[run.status] ?? run.status}
                    {run.status === "error" && run.error && (
                      <p className="text-xs text-destructive">{run.error}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {run.objectKey ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatBytes(run.sizeBytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
