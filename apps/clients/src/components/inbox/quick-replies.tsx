"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { orpc, orpcClient } from "@/lib/orpc/client";

/** Кнопка «Быстрые ответы»: попап со списком шаблонов (клик — вставить в
 * композер) и диалог управления шаблонами. Шаблоны общие на всю команду. */
export function QuickReplies({
  onInsert,
}: {
  onInsert: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery(
    orpc.messages.quickReplies.queryOptions({}),
  );
  const items = data?.items ?? [];
  const filtered = search.trim()
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(search.trim().toLowerCase()) ||
          i.text.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : items;

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.messages.quickReplies.key(),
    });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Быстрые ответы"
          >
            <ZapIcon className="size-3.5" />
            Шаблоны
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 p-0">
          <div className="border-b p-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск шаблона…"
              className="h-8 text-sm"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Загружаем…
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {items.length === 0
                  ? "Шаблонов пока нет — создайте первый"
                  : "Ничего не найдено"}
              </p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onInsert(item.text);
                    setOpen(false);
                  }}
                  className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/60"
                >
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground">
                    {item.text}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-t p-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setOpen(false);
                setManageOpen(true);
              }}
            >
              <PencilIcon className="size-3.5" />
              Управлять шаблонами
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <ManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        items={items}
        onChanged={invalidate}
      />
    </>
  );
}

function ManageDialog({
  open,
  onOpenChange,
  items,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Array<{ id: string; title: string; text: string }>;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, startSaving] = useTransition();

  const resetForm = () => {
    setEditingId(null);
    setTitle("");
    setText("");
  };

  const save = () => {
    if (!title.trim() || !text.trim() || saving) return;
    startSaving(async () => {
      await orpcClient.messages.saveQuickReply({
        id: editingId ?? undefined,
        title: title.trim(),
        text: text.trim(),
      });
      onChanged();
      resetForm();
    });
  };

  const remove = (id: string) => {
    startSaving(async () => {
      await orpcClient.messages.deleteQuickReply({ id });
      onChanged();
      if (editingId === id) resetForm();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Быстрые ответы</DialogTitle>
          <DialogDescription>
            Шаблоны сообщений, общие для всей команды.
          </DialogDescription>
        </DialogHeader>

        {items.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-md border">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.text}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Редактировать"
                  onClick={() => {
                    setEditingId(item.id);
                    setTitle(item.title);
                    setText(item.text);
                  }}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Удалить"
                  onClick={() => remove(item.id)}
                  disabled={saving}
                >
                  <Trash2Icon className="size-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {editingId ? "Редактирование шаблона" : "Новый шаблон"}
          </p>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название (например, «Приветствие»)"
          />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Текст сообщения…"
            className="min-h-24"
          />
          <div className="flex justify-end gap-2">
            {editingId && (
              <Button type="button" variant="ghost" onClick={resetForm}>
                Отмена
              </Button>
            )}
            <Button
              type="button"
              onClick={save}
              disabled={saving || !title.trim() || !text.trim()}
            >
              {saving ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <PlusIcon className="size-4" />
              )}
              {editingId ? "Сохранить" : "Добавить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
