"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpc } from "@/lib/orpc/client";

/**
 * Дублирует isValidStartParam из @psi-opora/bot-core: этот пакет нельзя
 * импортировать в клиентский бандл (тянет nodemailer), а правило простое —
 * Telegram принимает в start-параметре только латиницу, цифры, `_` и `-`,
 * до 64 символов.
 */
const START_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isStartParamSafe(keyword: string): boolean {
  return START_PARAM_RE.test(keyword.trim());
}

function stripAt(value: string): string {
  return value.trim().replace(/^@/, "");
}

export function useBotUsernames() {
  return useQuery(orpc.bot.getBotUsernames.queryOptions());
}

async function copyToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} скопирована`);
  } catch {
    toast.error("Браузер не дал скопировать — выделите ссылку вручную");
  }
}

/**
 * Готовые ссылки на ботов с кодовым словом в стартовом параметре: клиент
 * переходит по ссылке и сразу попадает в нужную кампанию, ничего не набирая.
 */
export function CampaignStartLinks({ keyword }: { keyword: string }) {
  const { data: usernames } = useBotUsernames();
  const code = keyword.trim();
  const telegram = stripAt(usernames?.telegram ?? "");
  const max = stripAt(usernames?.max ?? "");

  if (!code) return null;

  if (!isStartParamSafe(code)) {
    return (
      <p className="text-xs text-muted-foreground">
        Ссылку для этого слова собрать нельзя: в стартовом параметре
        поддерживаются только латиница, цифры, «_» и «-». Слово «{code}» бот
        примет, если клиент напишет его в чат сам.
      </p>
    );
  }

  if (!telegram && !max) {
    return (
      <p className="text-xs text-muted-foreground">
        Готовая ссылка появится, когда будет указан username бота — блок «Ссылки
        на ботов» в карточке кампаний.
      </p>
    );
  }

  const links = [
    telegram && {
      label: "Ссылка Telegram",
      url: `https://t.me/${telegram}?start=${code}`,
    },
    max && {
      label: "Ссылка MAX",
      url: `https://max.ru/${max}?start=${code}`,
    },
  ].filter(Boolean) as Array<{ label: string; url: string }>;

  return (
    <div className="flex flex-col gap-1">
      {links.map((link) => (
        <div key={link.url} className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-xs">
            {link.url}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            aria-label={`Скопировать ${link.label.toLowerCase()} для кодового слова ${code}`}
            onClick={() => copyToClipboard(link.url, link.label)}
          >
            <Copy />
          </Button>
          <Button
            asChild
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 p-0"
          >
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Открыть ${link.label.toLowerCase()} для кодового слова ${code}`}
            >
              <ExternalLink />
            </a>
          </Button>
        </div>
      ))}
    </div>
  );
}

function UsernameField({
  messenger,
  label,
  placeholder,
  value,
  onChange,
}: {
  messenger: "telegram" | "max";
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const queryClient = useQueryClient();
  const detect = useMutation(
    orpc.bot.detectBotUsername.mutationOptions({
      onSuccess: ({ username }) => {
        onChange(username);
        toast.success(`Определили: @${username}`);
        queryClient.invalidateQueries({
          queryKey: orpc.bot.getBotUsernames.key(),
        });
      },
      onError: (error) =>
        toast.error(
          error.message ||
            "Не удалось спросить username у мессенджера — введите вручную",
        ),
    }),
  );

  const inputId = `bot-username-${messenger}`;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={detect.isPending}
          onClick={() => detect.mutate({ messenger })}
        >
          <Wand2 data-icon="inline-start" />
          {detect.isPending ? "Спрашиваем…" : "Определить"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Username ботов нужны только для сборки ссылок в дашборде — в БД отдельных
 * полей под них нет, значения лежат в bot_texts (см. TG_BOT_USERNAME_KEY).
 * Кнопка «Определить» спрашивает username у самого мессенджера по токену,
 * введённому при подключении канала.
 */
export function BotUsernamesEditor() {
  const queryClient = useQueryClient();
  const { data } = useBotUsernames();
  const [telegram, setTelegram] = useState("");
  const [max, setMax] = useState("");

  // Значения приходят запросом — подставляем, как только загрузились.
  useEffect(() => {
    if (!data) return;
    setTelegram(data.telegram);
    setMax(data.max);
  }, [data]);

  const save = useMutation(
    orpc.bot.saveBotUsernames.mutationOptions({
      onSuccess: () => {
        toast.success("Username ботов сохранены");
        queryClient.invalidateQueries({
          queryKey: orpc.bot.getBotUsernames.key(),
        });
      },
      onError: (error) =>
        toast.error(error.message || "Не удалось сохранить username"),
    }),
  );

  const dirty =
    stripAt(telegram) !== (data?.telegram ?? "") ||
    stripAt(max) !== (data?.max ?? "");

  return (
    <div className="grid gap-3 rounded-lg border border-dashed bg-muted/30 p-3">
      <div>
        <p className="text-sm font-medium">Ссылки на ботов</p>
        <p className="text-xs text-muted-foreground">
          Нужны, чтобы собрать ссылку с кодовым словом: клиент переходит по ней
          и сразу попадает в кампанию. Нажмите «Определить» — username
          подставится из самого мессенджера.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <UsernameField
          messenger="telegram"
          label="Username Telegram-бота"
          placeholder="psiopora_bot"
          value={telegram}
          onChange={setTelegram}
        />
        <UsernameField
          messenger="max"
          label="Username бота в MAX"
          placeholder="psiopora_bot"
          value={max}
          onChange={setMax}
        />
      </div>
      <Alert>
        <AlertDescription className="text-xs">
          Ссылка MAX собирается по тому же образцу, что и телеграмная (
          <code>?start=</code>). Если MAX отдаёт диплинки в другом формате,
          проверьте ссылку перед публикацией.
        </AlertDescription>
      </Alert>
      <Button
        type="button"
        size="sm"
        className="self-start"
        disabled={!dirty || save.isPending}
        onClick={() =>
          save.mutate({ telegram: stripAt(telegram), max: stripAt(max) })
        }
      >
        {save.isPending ? "Сохраняем…" : "Сохранить username"}
      </Button>
    </div>
  );
}
