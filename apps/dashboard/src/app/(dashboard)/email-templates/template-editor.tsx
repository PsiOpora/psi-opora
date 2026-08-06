"use client";

import type { EmailTemplate } from "@psi-opora/db/queries";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc/client";

const SAMPLE_VALUES = { name: "Иван Иванов", email: "ivan@example.com" };

function renderPreview(html: string): string {
  return html
    .replaceAll("{{name}}", SAMPLE_VALUES.name)
    .replaceAll("{{email}}", SAMPLE_VALUES.email);
}

export function TemplateEditor({
  initialTemplate,
}: {
  initialTemplate?: EmailTemplate;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(initialTemplate?.title ?? "");
  const [subject, setSubject] = useState(initialTemplate?.subject ?? "");
  const [htmlBody, setHtmlBody] = useState(initialTemplate?.htmlBody ?? "");

  const mutation = useMutation(
    orpc.emailTemplates.save.mutationOptions({
      onSuccess: () => {
        toast.success("Шаблон сохранён");
        router.push("/email-templates");
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось сохранить шаблон");
      },
    }),
  );

  const insertPlaceholder = (placeholder: string) => {
    const el = textareaRef.current;
    if (!el) {
      setHtmlBody((prev) => prev + placeholder);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + placeholder + el.value.slice(end);
    setHtmlBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + placeholder.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const canSave =
    title.trim().length > 0 &&
    subject.trim().length > 0 &&
    htmlBody.trim().length > 0;

  const save = () => {
    mutation.mutate({
      id: initialTemplate?.id,
      title: title.trim(),
      subject: subject.trim(),
      htmlBody,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {initialTemplate ? "Редактирование шаблона" : "Новый шаблон"}
          </CardTitle>
          <CardDescription>
            HTML-код письма. Доступны переменные{" "}
            <code className="text-xs">{"{{name}}"}</code> (имя контакта) и{" "}
            <code className="text-xs">{"{{email}}"}</code> (email получателя)
            — подставляются автоматически при отправке.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-title" className="text-xs text-muted-foreground">
                Название шаблона
              </Label>
              <Input
                id="template-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Приветственное письмо"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-subject" className="text-xs text-muted-foreground">
                Тема письма
              </Label>
              <Input
                id="template-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Тема, которую увидит получатель"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="template-html" className="text-xs text-muted-foreground">
                  HTML-код письма
                </Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => insertPlaceholder("{{name}}")}
                  >
                    + {"{{name}}"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => insertPlaceholder("{{email}}")}
                  >
                    + {"{{email}}"}
                  </Button>
                </div>
              </div>
              <Textarea
                id="template-html"
                ref={textareaRef}
                value={htmlBody}
                onChange={(e) => setHtmlBody(e.target.value)}
                placeholder="<html>...</html>"
                className="min-h-96 font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Превью (на примерных данных)
              </Label>
              <div className="rounded-md border overflow-hidden bg-white min-h-96">
                {htmlBody.trim() ? (
                  <iframe
                    title="Превью письма"
                    srcDoc={renderPreview(htmlBody)}
                    sandbox=""
                    className="h-full w-full min-h-96"
                  />
                ) : (
                  <p className="p-3 text-sm text-muted-foreground">
                    Введите HTML, чтобы увидеть превью.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={!canSave || mutation.isPending}
              onClick={save}
            >
              {mutation.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/email-templates")}
            >
              Отмена
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
