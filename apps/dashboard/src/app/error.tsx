"use client";

import { AlertTriangleIcon, HomeIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangleIcon />
          </EmptyMedia>
          <EmptyTitle>Произошла ошибка</EmptyTitle>
          <EmptyDescription>
            {error.message ||
              "Что-то пошло не так. Попробуйте обновить страницу или вернитесь на главную."}
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Попробовать снова</Button>
          <Button variant="outline" asChild>
            <Link href="/">
              <HomeIcon />
              На главную
            </Link>
          </Button>
        </div>
      </Empty>
    </div>
  );
}
