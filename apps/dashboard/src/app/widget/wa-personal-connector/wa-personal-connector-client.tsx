"use client";

import { CheckIcon, Loader2Icon, MessageCircleIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orpcClient } from "@/lib/orpc/client";

type Step = "phone" | "pairing" | "connected" | "failed";

const POLL_INTERVAL_MS = 3000;

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
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
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
          phone: phone.trim(),
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
  }, [step, lineId, connectorId, phone]);

  if (!lineId || !connectorId) {
    return (
      <p className="text-xs text-destructive">
        Откройте это окно из настроек канала на линии в Контакт-центре — не
        удалось определить линию или коннектор.
      </p>
    );
  }

  const phoneValid = phone.trim().replace(/\D/g, "").length >= 10;

  const submitPhone = () => {
    if (!phoneValid) return;
    setError(null);
    startTransition(async () => {
      const res = await orpcClient.whatsappPersonal.startLogin({
        lineId,
        connectorId,
        phone: phone.trim(),
      });
      if (res.error || !res.code) {
        setError(res.error ?? "Не удалось получить код привязки");
        return;
      }
      setPairingCode(res.code);
      setStep("pairing");
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {step === "phone" && (
        <>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircleIcon className="size-3.5" />
            Личный номер WhatsApp
          </span>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+79991234567"
            aria-label="Номер телефона"
            disabled={busy}
          />
          <Button
            size="sm"
            onClick={submitPhone}
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
            устройства → «Привязать по номеру телефона» — введите этот код. Окно
            обновится само.
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            Ждём подтверждения на телефоне…
          </p>
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
