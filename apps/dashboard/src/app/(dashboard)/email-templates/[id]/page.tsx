"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { orpc } from "@/lib/orpc/client";
import { TemplateEditor } from "../template-editor";

export default function EditEmailTemplatePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: template, isLoading } = useQuery(
    orpc.emailTemplates.get.queryOptions({ input: { id } }),
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }
  if (!template) {
    return <p className="text-sm text-destructive">Шаблон не найден.</p>;
  }

  return <TemplateEditor initialTemplate={template} />;
}
