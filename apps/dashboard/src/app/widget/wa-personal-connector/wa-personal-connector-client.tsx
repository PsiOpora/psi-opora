"use client";

import { CheckIcon, Loader2Icon, MessageCircleIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orpcClient } from "@/lib/orpc/client";

type Step = "phone" | "pairing" | "connected" | "failed";

const POLL_INTERVAL_MS = 3000;

/** WAHA сама останавливает сессию, если pairing code не введён на телефоне
 * за ~2m40s (наблюдалось в логах: цикл QR-рефов истекает и сессия падает
 * с "QR code has not been scanned yet, force stopping the session"). Берём
 * с запасом поменьше, чтобы предупредить администратора заранее, а не ждать
 * молча, пока WAHA сама не отвалится. */
const CODE_TTL_MS = 140_000;

/** Нормализует ввод в цифры и подставляет код России, если его явно не
 * ввели — так «8 999 123 45 67» и «9991234567» превращаются в тот же номер,
 * что и «+7 999 123 45 67», без дополнительных действий администратора. */
function normalizePhoneDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "").slice(0, 15);
  if (digits.length === 11 && digits[0] === "8") digits = `7${digits.slice(1)}`;
  else if (digits.length === 10 && digits[0] === "9") digits = `7${digits}`;
  return digits;
}

/** Читаемое представление номера при вводе: для российских — привычная
 * группировка «+7 999 123-45-67», для остальных — интервалы по 3 цифры. */
function formatPhoneDisplay(digits: string): string {
  if (!digits) return "";
  if (digits[0] === "7" && digits.length <= 11) {
    const rest = digits.slice(1);
    let out = "+7";
    if (rest.length > 0) out += ` ${rest.slice(0, 3)}`;
    if (rest.length > 3) out += ` ${rest.slice(3, 6)}`;
    if (rest.length > 6) out += `-${rest.slice(6, 8)}`;
    if (rest.length > 8) out += `-${rest.slice(8, 10)}`;
    return out;
  }
  const cc = digits.slice(0, Math.min(2, digits.length));
  const rest = digits.slice(cc.length);
  let out = `+${cc}`;
  for (let i = 0; i < rest.length; i += 3) out += ` ${rest.slice(i, i + 3)}`;
  return out;
}

/**
 * Вход личного номера WhatsApp для конкретной линии Открытых линий Bitrix24:
 * телефон → pairing code (вводится на самом телефоне: WhatsApp → Связанные
 * устройства → Привязка по номеру телефона) → авто-подтверждение, когда
 * WAHA-сессия дошла до WORKING (см. whatsappPersonal.pollStatus).
 * Кодов из SMS и паролей здесь нет — в отличие от Telegram-виджета.
 */
export function WaPersonalConnectorClient({
  lineId,
  connectorId,
}: {
  lineId: string;
  connectorId: string;
}) {
  const [step, setStep] = useState<Step>("phone");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const pollingRef = useRef(false);

  // Пока показан pairing code — опрашиваем статус сессии; переход в
  // connected/failed останавливает опрос (сам эффект перезапускается по step).
  useEffect(() => {
    if (step !== "pairing") return;
    const timer = setInterval(async () => {
      if (pollingRef.current) return; // не накладываем запросы друг на друга
      pollingRef.current = true;
      try {
        const res = await orpcClient.whatsappPersonal.pollStatus({
          lineId,
          connectorId,
          phone: `+${phoneDigits}`,
        });
        if (res.status === "connected") {
          setActivationError(res.activationError ?? null);
          setStep("connected");
        } else if (res.status === "failed") {
          setError(res.error ?? "Подключение не удалось");
          setStep("failed");
        }
      } catch {
        // сетевые сбои поллинга не показываем — следующий тик повторит
      } finally {
        pollingRef.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [step, lineId, connectorId, phoneDigits]);

  // Обратный отсчёт до вероятного истечения pairing code — WAHA не сообщает
  // об этом отдельным статусом, поэтому считаем сами и подсказываем заранее.
  useEffect(() => {
    if (step !== "pairing" || !codeExpiresAt) return;
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.round((codeExpiresAt - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [step, codeExpiresAt]);

  if (!lineId || !connectorId) {
    return (
      <p className="text-xs text-destructive">
        Откройте это окно из настроек канала на линии в Контакт-центре — не
        удалось определить линию или коннектор.
      </p>
    );
  }

  const phoneValid = phoneDigits.length >= 10;

  const requestCode = () => {
    if (!phoneValid) return;
    setError(null);
    startTransition(async () => {
      const res = await orpcClient.whatsappPersonal.startLogin({
        lineId,
        connectorId,
        phone: `+${phoneDigits}`,
      });
      if (res.error || !res.code) {
        setError(res.error ?? "Не удалось получить код привязки");
        return;
      }
      setPairingCode(res.code);
      setCodeExpiresAt(Date.now() + CODE_TTL_MS);
      setStep("pairing");
    });
  };

  const codeExpired = step === "pairing" && secondsLeft <= 0 && codeExpiresAt !== null;
  const minutes = String(Math.floor(secondsLeft / 60)).padStart(1, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-1.5">
      {step === "phone" && (
        <>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircleIcon className="size-3.5" />
            Личный номер WhatsApp
          </span>
          <Input
            value={formatPhoneDisplay(phoneDigits)}
            onChange={(e) =>
              setPhoneDigits(normalizePhoneDigits(e.target.value))
            }
            placeholder="+7 999 123-45-67"
            aria-label="Номер телефона"
            inputMode="tel"
            autoComplete="tel"
            disabled={busy}
          />
          <Button
            size="sm"
            onClick={requestCode}
            disabled={busy || !phoneValid}
          >
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}
            Получить код привязки
          </Button>
        </>
      )}

      {step === "pairing" && (
        <>
          <p className="text-center font-mono text-lg tracking-widest">
            {pairingCode}
          </p>
          <p className="text-xs text-muted-foreground">
            На телефоне: WhatsApp → Настройки → Связанные устройства → Привязка
            устройства → «Привязать по номеру телефона» — введите этот код.
            Окно обновится само.
          </p>
          {codeExpired ? (
            <p className="text-xs text-destructive">
              Код, скорее всего, истёк — WhatsApp принимает его недолго.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Код действует ещё {minutes}:{seconds}
            </p>
          )}
          <Button
            size="sm"
            variant={codeExpired ? "default" : "outline"}
            onClick={requestCode}
            disabled={busy}
          >
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}
            Запросить новый код
          </Button>
          {!codeExpired && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Ждём подтверждения на телефоне…
            </p>
          )}
        </>
      )}

      {step === "connected" && (
        <>
          <p className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckIcon className="size-4" />
            Номер подключён к этой линии
          </p>
          {activationError && (
            <p className="text-xs text-destructive">
              Сессия сохранена, но линия не активировалась: {activationError}.
              Откройте настройки канала ещё раз.
            </p>
          )}
        </>
      )}

      {step === "failed" && (
        <Button size="sm" variant="outline" onClick={() => setStep("phone")}>
          Начать заново
        </Button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
