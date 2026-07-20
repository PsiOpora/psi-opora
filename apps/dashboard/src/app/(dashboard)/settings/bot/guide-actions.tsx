"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { orpc } from "@/lib/orpc/client";

export function SetActiveGuideButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation(
    orpc.bot.setActiveGuide.mutationOptions({
      onSuccess: () => {
        toast.success(`«${title}» теперь активный гайд`);
        queryClient.invalidateQueries({ queryKey: orpc.bot.listGuides.key() });
        queryClient.invalidateQueries({ queryKey: orpc.bot.getTexts.key() });
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось выполнить действие");
      },
    }),
  );

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate({ id })}
    >
      Сделать активным
    </Button>
  );
}

export function DeleteGuideButton({
  id,
  title,
  isActive,
}: {
  id: string;
  title: string;
  isActive: boolean;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation(
    orpc.bot.deleteGuide.mutationOptions({
      onSuccess: () => {
        toast.success(`«${title}» удалён`);
        queryClient.invalidateQueries({ queryKey: orpc.bot.listGuides.key() });
        queryClient.invalidateQueries({ queryKey: orpc.bot.getTexts.key() });
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось выполнить действие");
      },
    }),
  );

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={mutation.isPending}
        >
          Удалить
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить гайд?</AlertDialogTitle>
          <AlertDialogDescription>
            {isActive
              ? `«${title}» сейчас активен — после удаления бот перестанет слать вложение до выбора другого гайда.`
              : `Файл «${title}» будет удалён из библиотеки и из хранилища. Это необратимо.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate({ id })}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Удалить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
