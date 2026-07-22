"use client";

import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import { BoldIcon, CodeIcon, ItalicIcon, Link2Icon } from "lucide-react";
import type * as React from "react";
import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Кнопки разметки соответствуют «легаси» Markdown Telegram, с которым
 * реально отправляются сообщения (см. packages/jobs/src/messenger.ts):
 * *жирный*, _курсив_, `код`, [текст](ссылка) — без **, __ и других вариантов.
 */
const MARKDOWN_ACTIONS: Array<{
  label: string;
  icon: typeof BoldIcon;
  before: string;
  after: string;
  placeholder: string;
}> = [
  {
    label: "Жирный",
    icon: BoldIcon,
    before: "*",
    after: "*",
    placeholder: "жирный текст",
  },
  {
    label: "Курсив",
    icon: ItalicIcon,
    before: "_",
    after: "_",
    placeholder: "курсив",
  },
  { label: "Код", icon: CodeIcon, before: "`", after: "`", placeholder: "код" },
];

export interface MessageComposerProps {
  text: string;
  onTextChange: (text: string) => void;
  onSend: () => void;
  placeholder?: string;
  className?: string;
}

/** Тулбар разметки + textarea с автоотправкой по Enter (Shift+Enter — перенос
 * строки) и счётчиком символов — общая часть вкладки CRM (widget-message) и
 * единого инбокса дашборда («Клиенты»). */
export function MessageComposer({
  text,
  onTextChange,
  onSend,
  placeholder,
  className,
}: MessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wrapSelection = useCallback(
    (before: string, after: string, placeholderText: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      const selected = text.slice(start, end) || placeholderText;
      const next =
        text.slice(0, start) + before + selected + after + text.slice(end);
      onTextChange(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(
          start + before.length,
          start + before.length + selected.length,
        );
      });
    },
    [text, onTextChange],
  );

  const insertLink = useCallback(() => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const label = text.slice(start, end) || "текст ссылки";
    const url = "https://";
    const next = `${text.slice(0, start)}[${label}](${url})${text.slice(end)}`;
    onTextChange(next);
    const urlStart = start + label.length + 3;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(urlStart, urlStart + url.length);
    });
  }, [text, onTextChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const trimmedText = text.trim();
  const overLimit = trimmedText.length > MESSAGE_MAX_LENGTH;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex gap-1 rounded-t-md border border-b-0 bg-muted/40 p-1">
        {MARKDOWN_ACTIONS.map(
          ({ label, icon: Icon, before, after, placeholder: ph }) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              size="icon-sm"
              title={label}
              aria-label={label}
              onClick={() => wrapSelection(before, after, ph)}
            >
              <Icon className="size-3.5" />
            </Button>
          ),
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Ссылка"
          aria-label="Ссылка"
          onClick={insertLink}
        >
          <Link2Icon className="size-3.5" />
        </Button>
      </div>
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="min-h-28 rounded-t-none text-sm"
      />
      <span
        className={cn(
          "self-end text-xs",
          overLimit ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {trimmedText.length} / {MESSAGE_MAX_LENGTH}
        {overLimit && " — мессенджеры не примут такое длинное сообщение"}
      </span>
    </div>
  );
}

export { MESSAGE_MAX_LENGTH };
