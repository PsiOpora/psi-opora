"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export interface ActionResult {
  ok?: boolean;
  error?: string;
}

interface SubmitButtonProps {
  /** Server action формы, к которой относится эта кнопка (closest("form")). */
  action: (formData: FormData) => Promise<ActionResult | undefined>;
  /** Текст кнопки в обычном состоянии. */
  idleLabel: string;
  /** Сообщение toast при успехе. */
  successMessage: string;
  /** Текст кнопки/toast во время выполнения. */
  loadingMessage?: string;
  /** Сообщение об ошибке по умолчанию, если action не вернул текст ошибки. */
  errorMessage?: string;
  /** Сбросить форму после успешного сохранения (для форм ввода новой записи). */
  resetOnSuccess?: boolean;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}

/**
 * Кнопка отправки формы с server action: перехватывает сабмит, показывает
 * toast-статус (загрузка → успех/ошибка) и обновляет серверные данные.
 * Форма должна валидироваться нативно (required и т.п.) — используется
 * form.reportValidity().
 */
export function SubmitButton({
  action,
  idleLabel,
  successMessage,
  loadingMessage = "Сохраняем…",
  errorMessage = "Не удалось выполнить действие",
  resetOnSuccess = false,
  className,
  variant,
  size,
}: SubmitButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const form = event.currentTarget.closest("form");
    if (!form) return;
    if (!form.reportValidity()) return;
    event.preventDefault();

    const formData = new FormData(form);
    startTransition(async () => {
      const toastId = toast.loading(loadingMessage);
      try {
        const result = await action(formData);
        if (result && result.ok === false) {
          toast.error(result.error ?? errorMessage, { id: toastId });
          return;
        }
        toast.success(successMessage, { id: toastId });
        if (resetOnSuccess) form.reset();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : errorMessage, {
          id: toastId,
        });
      }
    });
  };

  return (
    <Button
      type="submit"
      onClick={onClick}
      disabled={isPending}
      className={className}
      variant={variant}
      size={size}
    >
      {isPending ? loadingMessage : idleLabel}
    </Button>
  );
}
