"use client";

import { useSearchParams } from "next/navigation";
import { buildMaxLink, buildTelegramLink, resolveStartCode, type SiteCodeKey } from "@/lib/messenger-links";

export function MessengerButtons({ code }: { code: SiteCodeKey }) {
  const searchParams = useSearchParams();
  const startCode = resolveStartCode(code, searchParams);

  return (
    <div className="msg-btns">
      <a href={buildMaxLink(startCode)} className="msg-btn msg-max" target="_blank" rel="noopener noreferrer">
        <svg className="mi" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,.18)" />
          <path d="M7 8h10M7 12h10M7 16h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span>
          Оставить заявку в МАКС
          <small>Ответим в мессенджере МАКС</small>
        </span>
      </a>
      <a href={buildTelegramLink(startCode)} className="msg-btn msg-tg" target="_blank" rel="noopener noreferrer">
        <svg className="mi" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,.18)" />
          <path d="M6 12l11-4-2 10-3-3-2 2-1-4-3-1z" fill="#fff" />
        </svg>
        <span>
          Оставить заявку в Телеграм
          <small>Ответим в Telegram</small>
        </span>
      </a>
    </div>
  );
}
