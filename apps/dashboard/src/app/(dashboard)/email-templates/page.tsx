"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/orpc/client";
import { TemplateList } from "./template-list";

export default function EmailTemplatesPage() {
  const { data: templates = [], isLoading } = useQuery(
    orpc.emailTemplates.list.queryOptions(),
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Шаблоны писем</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Собственные HTML-шаблоны для email-рассылок — без зависимости от
            личного кабинета Unisender. Доступны переменные{" "}
            <code className="text-xs">{"{{name}}"}</code> и{" "}
            <code className="text-xs">{"{{email}}"}</code>.
          </p>
        </div>
        <Button asChild>
          <Link href="/email-templates/new">Создать шаблон</Link>
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <TemplateList templates={templates} />
      )}
    </div>
  );
}
