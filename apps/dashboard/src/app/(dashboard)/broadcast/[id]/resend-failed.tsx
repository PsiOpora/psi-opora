"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
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
import { orpcClient } from "@/lib/orpc/client";

export function ResendFailed({
  broadcastId,
  failedCount,
}: {
  broadcastId: string;
  failedCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      const toastId = toast.loading("Ставим досылку в очередь…");
      const res = await orpcClient.broadcast.resendFailed({ broadcastId });
      if (res.error) {
        toast.error(res.error, { id: toastId });
      } else {
        toast.success(`Досылка запущена: ${res.queued} получателей в очереди`, {
          id: toastId,
        });
      }
      router.refresh();
    });
  };

  return (
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
  );
}
