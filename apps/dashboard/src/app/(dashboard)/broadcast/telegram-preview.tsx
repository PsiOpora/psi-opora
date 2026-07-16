"use client";

import type { ReactNode } from "react";

/**
 * Разметка Telegram (легаси-Markdown, как отправляют боты проекта):
 * *жирный*, _курсив_, `код`, ```блок кода```, [текст](url).
 * Вложенность легаси-режим не поддерживает — парсер тоже.
 */
const TOKEN_RE =
  /```([\s\S]*?)```|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function renderTelegramMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    if (match[1] !== undefined) {
      nodes.push(
        <pre
          key={key++}
          className="my-1 overflow-x-auto rounded bg-black/10 px-2 py-1 font-mono text-xs dark:bg-white/10"
        >
          {match[1].trim()}
        </pre>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-black/10 px-1 font-mono text-[0.85em] dark:bg-white/10"
        >
          {match[2]}
        </code>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={key++}>{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      nodes.push(<em key={key++}>{match[4]}</em>);
    } else if (match[5] !== undefined) {
      nodes.push(
        <a
          key={key++}
          href={match[6]}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 underline underline-offset-2 dark:text-blue-300"
        >
          {match[5]}
        </a>,
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Символы разметки, оставшиеся вне валидных пар. Telegram отклоняет
 * сообщение с незакрытой сущностью — тогда рассылка уйдёт без форматирования.
 */
export function findUnbalancedMarkers(text: string): string[] {
  const rest = text.replace(TOKEN_RE, "");
  const markers: string[] = [];
  if (rest.includes("*")) markers.push("*");
  if (rest.includes("_")) markers.push("_");
  if (rest.includes("`")) markers.push("`");
  return markers;
}

/** Сообщение так, как его увидит клиент в Telegram (исходящий «пузырь»). */
export function TelegramPreview({ text }: { text: string }) {
  const nodes = renderTelegramMarkdown(text);
  const unbalanced = findUnbalancedMarkers(text);
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-lg border bg-muted/40 p-3">
        <div className="ml-auto w-fit max-w-full">
          <div className="max-w-md rounded-2xl rounded-br-sm bg-[#effdde] px-3 py-2 text-sm text-gray-900 shadow-sm dark:bg-[#2b5278] dark:text-gray-50">
            <div className="whitespace-pre-wrap break-words">
              {text ? (
                nodes
              ) : (
                <span className="opacity-50">
                  Текст сообщения появится здесь…
                </span>
              )}
            </div>
            <div className="mt-0.5 text-right text-[10px] leading-none text-gray-500 dark:text-gray-300">
              {time} ✓✓
            </div>
          </div>
        </div>
      </div>
      {unbalanced.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          ⚠️ Непарная разметка: {unbalanced.join(" ")} — Telegram отклонит
          такое форматирование, сообщение уйдёт обычным текстом.
        </p>
      )}
    </div>
  );
}
