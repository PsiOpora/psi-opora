"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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

  const onClick = () => {
    if (
      !window.confirm(
        `Дослать сообщение ${failedCount} получателям, у которых была ошибка отправки?\n\nБудет отправлен тот же текст этой рассылки. Те, кто уже получил сообщение, повторно его НЕ получат.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await resendFailedAction(broadcastId);
      setResult(
        res.error ??
          `Досланы: ${res.resent}${res.stillFailed > 0 ? `, снова с ошибкой: ${res.stillFailed}` : ""}`,
      );
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={isPending} onClick={onClick}>
        {isPending ? "Отправка…" : `Дослать (${failedCount})`}
      </Button>
      {result && (
        <span className="text-xs text-muted-foreground">{result}</span>
      )}
    </div>
  );
}
