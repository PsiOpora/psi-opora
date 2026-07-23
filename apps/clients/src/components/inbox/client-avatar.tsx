"use client";

import type { InboxMessenger } from "@psi-opora/api";
import { useState } from "react";
import { MESSENGER_META } from "@/components/inbox/messenger-meta";
import { MessengerIcon } from "@/components/inbox/messenger-icon";
import { cn } from "@/lib/utils";

const FALLBACK_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

export function ClientAvatar({
  name,
  avatarUrl,
  messenger,
  size = "md",
  className,
}: {
  name: string;
  avatarUrl: string | null;
  /** Показывает цветную точку канала в углу аватара. */
  messenger?: InboxMessenger;
  size?: "md" | "lg";
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!avatarUrl && !imageFailed;
  const color =
    FALLBACK_COLORS[hashString(name) % FALLBACK_COLORS.length] ?? "bg-sky-500";
  const meta = messenger ? MESSENGER_META[messenger] : null;

  return (
    <div className={cn("relative shrink-0", className)}>
      {showImage ? (
        // Аватары приходят по внешним URL мессенджеров — next/image здесь не
        // используем, чтобы не описывать все возможные хосты в конфиге.
        // biome-ignore lint/performance/noImgElement: внешние URL аватаров
        <img
          src={avatarUrl}
          alt=""
          onError={() => setImageFailed(true)}
          className={cn(
            "rounded-full object-cover",
            size === "lg" ? "size-16" : "size-10",
          )}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-full font-medium text-white",
            color,
            size === "lg" ? "size-16 text-xl" : "size-10 text-sm",
          )}
        >
          {initials(name)}
        </div>
      )}
      {meta && messenger && (
        <span
          title={meta.label}
          className={cn(
            "absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-background",
            size === "lg" ? "size-5" : "size-4",
          )}
        >
          <MessengerIcon messenger={messenger} className="size-full" />
        </span>
      )}
    </div>
  );
}
