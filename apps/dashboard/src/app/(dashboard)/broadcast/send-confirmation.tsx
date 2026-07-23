"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { RecentBroadcastInfo } from "@psi-opora/api";
import { LARGE_AUDIENCE_THRESHOLD } from "@psi-opora/api/schemas";
import { WarningBox } from "@/components/messaging/warning-box";
import { TelegramPreview } from "./telegram-preview";

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

export function SendConfirmation({
  stageLabel,
  channelLabel,
  message,
  sendableCount,
  hasManualSelection,
  skippedCount,
  recentBroadcast,
  ackChecked,
  onAckChange,
  onConfirm,
  onCancel,
  isPending,
}: {
  stageLabel: string;
  channelLabel: string;
  message: string;
  sendableCount: number;
  hasManualSelection: boolean;
  skippedCount: number;
  recentBroadcast: RecentBroadcastInfo | null;
  ackChecked: boolean;
  onAckChange: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle>Подтверждение отправки</CardTitle>
        <CardDescription>
          Проверьте всё ещё раз — отменить рассылку после запуска невозможно.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-sm">
          <p>
            <span className="text-muted-foreground">Стадия:</span>{" "}
            {stageLabel}
          </p>
          <p>
            <span className="text-muted-foreground">Канал:</span>{" "}
            {channelLabel}
          </p>
          <p>
            <span className="text-muted-foreground">Получат сообщение:</span>{" "}
            {sendableCount} контактов
            {hasManualSelection
              ? " (отмечены вручную, остальные пропущены)"
              : ""}
            {skippedCount > 0 &&
              ` (ещё ${skippedCount} будут пропущены — нет мессенджера)`}
          </p>
        </div>

        {recentBroadcast && (
          <WarningBox>
            По этой стадии уже была рассылка{" "}
            {formatDateTime(recentBroadcast.startedAt)} (отправлено:{" "}
            {recentBroadcast.sentCount}). Убедитесь, что не отправляете то же
            самое повторно.
          </WarningBox>
        )}
        {sendableCount > LARGE_AUDIENCE_THRESHOLD && (
          <WarningBox>
            Большая аудитория: {sendableCount} получателей. Отправка займёт
            несколько минут, не закрывайте страницу. Рекомендуем сначала
            отправить тест себе кнопкой «Тест» в предпросмотре.
          </WarningBox>
        )}

        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            Сообщение, которое получат клиенты:
          </p>
          <TelegramPreview text={message} />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ackChecked}
            onChange={(e) => onAckChange(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Я проверил(а) список получателей и текст сообщения. Понимаю, что
            сообщение уйдёт реальным клиентам.
          </span>
        </label>

        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={!ackChecked || isPending}
            onClick={onConfirm}
          >
            {isPending ? "Отправка…" : `Отправить ${sendableCount} сообщений`}
          </Button>
          <Button variant="outline" disabled={isPending} onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
