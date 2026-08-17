"use client";

import { CheckIcon, Loader2Icon, MessageCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orpcClient } from "@/lib/orpc/client";

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

type Step = "phone" | "code" | "connected";

export function MaxPersonalConnectorClient({
  lineId,
  connectorId,
}: {
  lineId: string;
  connectorId: string;
}) {
  const [step, setStep] = useState<Step>("phone");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(6);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (!lineId || !connectorId) {
    return (
      <p className="text-xs text-destructive">
        Не удалось определить линию или коннектор.
      </p>
    );
  }

  const submitPhone = () => {
    if (phoneDigits.length < 5) return;
    setError(null);
    startTransition(async () => {
      const result = await orpcClient.maxPersonal.startLogin({
        lineId,
        connectorId,
        phone: `+${phoneDigits}`,
      });
      if (result.error || !result.loginId) {
        setError(result.error ?? "Не удалось отправить код");
        return;
      }
      setLoginId(result.loginId);
      setCodeLength(result.codeLength ?? 6);
      setStep("code");
    });
  };

  const resendCode = () => {
    setError(null);
    startTransition(async () => {
      const result = await orpcClient.maxPersonal.startLogin({
        lineId,
        connectorId,
        phone: `+${phoneDigits}`,
      });
      if (result.error || !result.loginId) {
        setError(result.error ?? "Не удалось отправить код");
        return;
      }
      setLoginId(result.loginId);
      setCodeLength(result.codeLength ?? 6);
      setCode("");
    });
  };

  const submitCode = () => {
    if (!loginId || !code.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await orpcClient.maxPersonal.submitCode({
        loginId,
        code: code.trim(),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setActivationError(result.activationError ?? null);
      setStep("connected");
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {step === "phone" && (
        <>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircleIcon className="size-3.5" /> Личный номер MAX
          </span>
          <Input
            value={formatPhoneDisplay(phoneDigits)}
            onChange={(e) =>
              setPhoneDigits(normalizePhoneDigits(e.target.value))
            }
            placeholder="+7 999 123-45-67"
            inputMode="tel"
            disabled={busy}
            autoFocus
          />
          <Button
            size="sm"
            onClick={submitPhone}
            disabled={busy || phoneDigits.length < 5}
          >
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}{" "}
            Отправить код
          </Button>
        </>
      )}
      {step === "code" && (
        <>
          <p className="text-xs text-muted-foreground">
            Проверьте чат «Коды подтверждения» (@verificationcodes_bot) на
            основном устройстве MAX. Если код не появился там, SMS может прийти
            примерно через 5 минут.
          </p>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={`Код (${codeLength} цифр)`}
            inputMode="numeric"
            maxLength={codeLength}
            disabled={busy}
            autoFocus
          />
          <Button
            size="sm"
            onClick={submitCode}
            disabled={busy || !code.trim()}
          >
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}{" "}
            Подтвердить
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={resendCode}
            disabled={busy}
          >
            Отправить код повторно
          </Button>
        </>
      )}
      {step === "connected" && (
        <>
          <p className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckIcon className="size-4" /> Номер подключён к этой линии
          </p>
          {activationError && (
            <p className="text-xs text-destructive">
              Сессия сохранена, но линия не активировалась: {activationError}
            </p>
          )}
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
