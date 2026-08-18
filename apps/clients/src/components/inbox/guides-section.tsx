"use client";

import type { ClientGuideItem } from "@psi-opora/api";
import { useQuery } from "@tanstack/react-query";
import {
  BellRingIcon,
  BookOpenCheckIcon,
  CalendarCheckIcon,
  EyeIcon,
  EyeOffIcon,
  MailCheckIcon,
  MailXIcon,
} from "lucide-react";
import type { SelectedClient } from "@/components/inbox/thread-pane";
import { Separator } from "@/components/ui/separator";
import { formatFullDate } from "@/lib/format";
import { orpc } from "@/lib/orpc/client";

/** Одна строка события внутри карточки материала. */
function Event({
  icon: Icon,
  text,
  tone = "muted",
}: {
  icon: typeof EyeIcon;
  text: string;
  tone?: "muted" | "good" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className={`flex items-start gap-1.5 text-[11px] ${color}`}>
      <Icon className="mt-0.5 size-3 shrink-0" />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function GuideCard({ guide }: { guide: ClientGuideItem }) {
  const opened = Boolean(guide.firstOpenedAt);
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium break-words">
          {guide.title}
        </span>
        {/* Открытие материала — главный сигнал в карточке: остальное бот
            делает сам, а вот дошёл ли клиент до файла, иначе не увидеть. */}
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
            opened
              ? "bg-emerald-500/15 text-emerald-700"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {opened ? "открыт" : "не открыт"}
        </span>
      </div>

      <Event
        icon={BookOpenCheckIcon}
        text={`Выдан ${formatFullDate(guide.deliveredAt)}`}
      />

      {guide.emailSentAt ? (
        <Event
          icon={MailCheckIcon}
          tone="good"
          text={`Письмо на ${guide.email} — ${formatFullDate(guide.emailSentAt)}`}
        />
      ) : guide.email ? (
        <Event
          icon={MailXIcon}
          tone="bad"
          text={`Письмо на ${guide.email} не отправлено`}
        />
      ) : (
        <Event icon={MailXIcon} text="Email не оставил — письма не было" />
      )}

      {opened ? (
        <Event
          icon={EyeIcon}
          tone="good"
          text={
            guide.openCount > 1
              ? `Открыл ${formatFullDate(guide.firstOpenedAt)} · всего открытий ${guide.openCount}, последнее ${formatFullDate(guide.lastOpenedAt)}`
              : `Открыл ${formatFullDate(guide.firstOpenedAt)}`
          }
        />
      ) : (
        <Event
          icon={EyeOffIcon}
          text="Ссылку в чате не открывал (файл из письма так не отследить)"
        />
      )}

      {guide.followUpSentAt && (
        <Event
          icon={BellRingIcon}
          text={`Напоминание ${formatFullDate(guide.followUpSentAt)}`}
        />
      )}

      {guide.diagnosticRequestedAt && (
        <Event
          icon={CalendarCheckIcon}
          tone="good"
          text={`Заявка на диагностику ${formatFullDate(guide.diagnosticRequestedAt)}`}
        />
      )}
    </div>
  );
}

/**
 * Что происходило с материалами клиента: выдача, письмо, открытия,
 * напоминание, заявка. Секция скрывается целиком, если материалов не было —
 * у клиентов из флоу консультации их и не бывает.
 */
export function GuidesSection({ selected }: { selected: SelectedClient }) {
  const { data } = useQuery(
    orpc.messages.guideActivity.queryOptions({
      input: { messenger: selected.messenger, userId: selected.userId },
    }),
  );
  const guides = data?.guides ?? [];

  // Пока грузим и когда материалов нет — ничего не показываем: у клиентов из
  // флоу консультации материалов не бывает, и пустой блок в панели лишний.
  if (guides.length === 0) return null;

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
          <BookOpenCheckIcon className="size-3.5" />
          Материалы
        </div>
        <div className="flex flex-col gap-1.5">
          {guides.map((guide) => (
            <GuideCard key={guide.campaignId} guide={guide} />
          ))}
        </div>
      </div>
    </>
  );
}
