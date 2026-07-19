"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
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
import type { ActionResult } from "./submit-button";

interface ActionButtonProps {
  /** Server action, вызывается с FormData, собранной из `values`. */
  action: (formData: FormData) => Promise<ActionResult | undefined>;
  /** Поля, которые нужно передать в action (например, { id: cost.id }). */
  values: Record<string, string>;
  children: ReactNode;
  successMessage: string;
  loadingMessage?: string;
  errorMessage?: string;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  "aria-label"?: string;
  /** Если задано — перед выполнением показывается диалог подтверждения (для необратимых действий). */
  confirm?: {
    title: string;
    description: string;
    confirmLabel?: string;
    destructive?: boolean;
  };
}

/**
 * Кнопка для точечных server actions (удалить строку, переключить статус),
 * не привязанных к целой форме: сама строит FormData, показывает toast
 * и опционально требует подтверждения через AlertDialog.
 */
export function ActionButton({
  action,
  values,
  children,
  successMessage,
  loadingMessage = "Выполняем…",
  errorMessage = "Не удалось выполнить действие",
  className,
  variant,
  size,
  confirm,
  ...rest
}: ActionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) {
      formData.set(key, value);
    }
    startTransition(async () => {
      const toastId = toast.loading(loadingMessage);
      try {
        const result = await action(formData);
        if (result && result.ok === false) {
          toast.error(result.error ?? errorMessage, { id: toastId });
          return;
        }
        toast.success(successMessage, { id: toastId });
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : errorMessage, {
          id: toastId,
        });
      }
    });
  };

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={isPending}
      onClick={confirm ? undefined : run}
      aria-label={rest["aria-label"]}
    >
      {children}
    </Button>
  );

  if (!confirm) return button;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={run}
            className={
              confirm.destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {confirm.confirmLabel ?? "Подтвердить"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
