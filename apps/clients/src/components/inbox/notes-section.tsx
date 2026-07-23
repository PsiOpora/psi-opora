"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import type {
  CurrentOperator,
  SelectedClient,
} from "@/components/inbox/thread-pane";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatFullDate } from "@/lib/format";
import { orpc, orpcClient } from "@/lib/orpc/client";

/** Внутренние заметки по клиенту — видны только команде, клиенту не уходят. */
export function NotesSection({
  selected,
  operator,
}: {
  selected: SelectedClient;
  operator: CurrentOperator | null;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [saving, startSaving] = useTransition();

  const input = { messenger: selected.messenger, userId: selected.userId };
  const { data, isLoading } = useQuery(
    orpc.messages.notes.queryOptions({ input }),
  );
  const notes = data?.notes ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.messages.notes.key({ input }),
    });

  const add = () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    startSaving(async () => {
      await orpcClient.messages.addNote({
        ...input,
        text: trimmed,
        operatorId: operator?.id,
        operatorName: operator?.name,
      });
      setText("");
      invalidate();
    });
  };

  const remove = (noteId: string) => {
    if (!window.confirm("Удалить заметку?")) return;
    startSaving(async () => {
      await orpcClient.messages.deleteNote({ noteId });
      invalidate();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
        <StickyNoteIcon className="size-3.5" />
        Заметки
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Загружаем…
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Заметок пока нет. Видны только команде.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {notes.map((note) => (
            <div
              key={note.id}
              className="group rounded-lg bg-amber-500/10 p-2.5 text-sm"
            >
              <p className="whitespace-pre-wrap">{note.text}</p>
              <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>
                  {note.operatorName ? `${note.operatorName} · ` : ""}
                  {formatFullDate(note.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(note.id)}
                  title="Удалить заметку"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2Icon className="size-3 text-destructive" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Новая заметка… (Ctrl+Enter — сохранить)"
        className="min-h-16 text-sm"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={saving || !text.trim()}
        className="self-end"
      >
        {saving && <Loader2Icon className="size-3.5 animate-spin" />}
        Добавить заметку
      </Button>
    </div>
  );
}
