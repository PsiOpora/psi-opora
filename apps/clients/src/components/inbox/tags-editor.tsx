"use client";

import { TagIcon, XIcon } from "lucide-react";
import { useState, useTransition } from "react";
import type { SelectedClient } from "@/components/inbox/thread-pane";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { orpcClient } from "@/lib/orpc/client";

/** Теги диалога: чипы с удалением по клику + инпут (Enter или запятая —
 * добавить). Каждое изменение сразу сохраняется на сервере. */
export function TagsEditor({
  selected,
  tags,
  onSaved,
}: {
  selected: SelectedClient;
  tags: string[];
  onSaved: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [, startSaving] = useTransition();

  const save = (next: string[]) => {
    startSaving(async () => {
      await orpcClient.messages.setTags({
        messenger: selected.messenger,
        userId: selected.userId,
        tags: next,
      });
      onSaved(next);
    });
  };

  const addTag = () => {
    const tag = input.trim().replace(/,$/, "");
    setInput("");
    if (!tag || tags.includes(tag)) return;
    save([...tags, tag]);
  };

  const removeTag = (tag: string) => {
    save(tags.filter((t) => t !== tag));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
        <TagIcon className="size-3.5" />
        Теги
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs">
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                title={`Убрать тег «${tag}»`}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
              >
                <XIcon className="size-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={input}
        onChange={(e) => {
          if (e.target.value.endsWith(",")) {
            setInput(e.target.value);
            addTag();
            return;
          }
          setInput(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addTag();
          }
        }}
        placeholder="Добавить тег… (Enter)"
        className="h-8 text-sm"
      />
    </div>
  );
}
