"use client";

import type { EmailTemplate } from "@psi-opora/db/queries";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { orpc } from "@/lib/orpc/client";

function formatDateTime(date: Date | string | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

function DeleteTemplateButton({ id, title }: { id: string; title: string }) {
  const queryClient = useQueryClient();

  const mutation = useMutation(
    orpc.emailTemplates.remove.mutationOptions({
      onSuccess: () => {
        toast.success(`Шаблон «${title}» удалён`);
        queryClient.invalidateQueries({
          queryKey: orpc.emailTemplates.list.key(),
        });
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось удалить шаблон");
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
          <AlertDialogTitle>Удалить шаблон?</AlertDialogTitle>
          <AlertDialogDescription>
            «{title}» будет удалён безвозвратно. Кампании, уже запущенные с
            этим шаблоном, не пострадают.
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

export function TemplateList({ templates }: { templates: EmailTemplate[] }) {
  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Шаблонов пока нет — нажмите «Создать шаблон», чтобы добавить первый.
      </p>
    );
  }

  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Тема письма</TableHead>
              <TableHead>Обновлён</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/email-templates/${t.id}`}
                    className="underline underline-offset-2"
                  >
                    {t.title}
                  </Link>
                </TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">
                  {t.subject}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(t.updatedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/email-templates/${t.id}`}>
                        Редактировать
                      </Link>
                    </Button>
                    <DeleteTemplateButton id={t.id} title={t.title} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
