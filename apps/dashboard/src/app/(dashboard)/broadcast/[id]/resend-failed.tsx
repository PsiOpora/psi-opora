"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { resendFailedAction } from "../actions";

export function ResendFailed({
  broadcastId,
  failedCount,
}: {
  broadcastId: string;
  failedCount: number;
}) {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      const res = await resendFailedAction(broadcastId);
      setResult(
        res.error ?? `Досылка запущена: ${res.queued} получателей в очереди`,
      );
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={isPending}>
            {isPending ? "Отправка…" : `Дослать (${failedCount})`}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Дослать сообщение?</AlertDialogTitle>
            <AlertDialogDescription>
              Сообщение этой рассылки будет повторно отправлено {failedCount}{" "}
              получателям, у которых была ошибка отправки. Те, кто уже получил
              сообщение, повторно его не получат.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Дослать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {result && (
        <span className="text-xs text-muted-foreground">{result}</span>
      )}
    </div>
  );
}
