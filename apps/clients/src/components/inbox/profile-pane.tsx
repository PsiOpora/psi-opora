"use client";

import type { ClientListItem } from "@psi-opora/api";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  AtSignIcon,
  Loader2Icon,
  MegaphoneIcon,
  MessagesSquareIcon,
  type UserIcon,
} from "lucide-react";
import { ClientAvatar } from "@/components/inbox/client-avatar";
import { CrmSection } from "@/components/inbox/crm-section";
import { messengerLabel } from "@/components/inbox/messenger-meta";
import { NotesSection } from "@/components/inbox/notes-section";
import { TagsEditor } from "@/components/inbox/tags-editor";
import type {
  CurrentOperator,
  SelectedClient,
} from "@/components/inbox/thread-pane";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatFullDate } from "@/lib/format";
import { orpc } from "@/lib/orpc/client";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-words">{value}</span>
    </div>
  );
}

function formatPresence(
  status: string | null,
  lastSeenAt: string | null,
): string | null {
  if (status === "online") return "Сейчас в сети";
  if (status === "typing") return "Печатает…";
  if (status === "recording") return "Записывает аудио…";
  if (status === "recently") return "Был(а) недавно";
  if (status === "within_week") return "Был(а) на этой неделе";
  if (status === "within_month") return "Был(а) в этом месяце";
  if (status === "long_time_ago") return "Был(а) давно";
  if (lastSeenAt) return formatFullDate(lastSeenAt);
  if (status === "offline" || status === "paused") return "Не в сети";
  return null;
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof UserIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
        <Icon className="size-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

export function ProfilePane({
  selected,
  client,
  operator,
  onTagsSaved,
}: {
  selected: SelectedClient;
  client: ClientListItem | undefined;
  operator: CurrentOperator | null;
  onTagsSaved: (tags: string[]) => void;
}) {
  const { data, isLoading } = useQuery(
    orpc.messages.profile.queryOptions({
      input: { messenger: selected.messenger, userId: selected.userId },
    }),
  );

  if (isLoading) {
    return (
      <div className="flex w-[300px] shrink-0 items-center justify-center gap-2 border-l text-sm text-muted-foreground xl:w-[340px]">
        <Loader2Icon className="size-4 animate-spin" />
        Загружаем профиль…
      </div>
    );
  }

  const profile = data?.profile;
  if (!profile) return null;

  const fullName =
    profile.name ??
    [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const displayName = fullName || profile.username || profile.userId;

  const isTelegramChannel =
    profile.messenger === "telegram" ||
    profile.messenger === "telegram-personal";
  const usernameLink =
    profile.username && isTelegramChannel ? (
      <a
        href={`https://t.me/${profile.username}`}
        target="_blank"
        rel="noreferrer"
        className="text-primary hover:underline"
      >
        @{profile.username}
      </a>
    ) : profile.username ? (
      `@${profile.username}`
    ) : null;

  return (
    <div className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l p-4 xl:w-[340px]">
      <div className="flex flex-col items-center gap-2 text-center">
        <ClientAvatar
          name={displayName}
          avatarUrl={profile.avatarUrl}
          messenger={profile.messenger}
          size="lg"
        />
        <div>
          <p className="font-semibold">{displayName}</p>
          <p className="text-xs text-muted-foreground">
            {messengerLabel(profile.messenger)} · ID {profile.userId}
          </p>
        </div>
        {profile.isPremium && (
          <Badge variant="secondary" className="text-xs">
            Telegram Premium
          </Badge>
        )}
      </div>

      {profile.bio && (
        <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">
          {profile.bio}
        </p>
      )}

      <Separator />

      <CrmSection selected={selected} />

      <Separator />

      <TagsEditor
        selected={selected}
        tags={client?.tags ?? []}
        onSaved={onTagsSaved}
      />

      <Separator />

      <NotesSection selected={selected} operator={operator} />

      <Separator />

      <Section icon={AtSignIcon} title="Контакты">
        <Row label="Username" value={usernameLink} />
        <Row label="Язык" value={profile.languageCode?.toUpperCase()} />
      </Section>

      {(profile.source || profile.campaign) && (
        <>
          <Separator />
          <Section icon={MegaphoneIcon} title="Источник">
            <Row label="UTM source" value={profile.source} />
            <Row label="Кампания" value={profile.campaign} />
          </Section>
        </>
      )}

      <Separator />

      <Section icon={ActivityIcon} title="Активность">
        <Row
          label="В мессенджере"
          value={formatPresence(
            profile.presenceStatus,
            profile.messengerLastSeenAt,
          )}
        />
        {profile.presenceObservedAt && profile.presenceStatus && (
          <Row
            label="Статус проверен"
            value={formatFullDate(profile.presenceObservedAt)}
          />
        )}
        <Row
          label="Первое обращение"
          value={formatFullDate(profile.firstSeenAt)}
        />
        <Row
          label="Активность у нас"
          value={formatFullDate(profile.lastSeenAt)}
        />
      </Section>

      <Separator />

      <Section icon={MessagesSquareIcon} title="Переписка">
        <Row label="Всего сообщений" value={profile.stats.totalCount} />
        <Row label="От клиента" value={profile.stats.inCount} />
        <Row label="Отправлено ему" value={profile.stats.outCount} />
        <Row
          label="Первое сообщение"
          value={formatFullDate(profile.stats.firstMessageAt)}
        />
        <Row
          label="Последнее"
          value={formatFullDate(profile.stats.lastMessageAt)}
        />
      </Section>
    </div>
  );
}
