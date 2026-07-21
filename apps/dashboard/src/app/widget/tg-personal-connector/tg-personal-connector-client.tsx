"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpcClient } from "@/lib/orpc/client";

type Step = "phone" | "code" | "password" | "connected";

/**
 * Пошаговый вход в личный аккаунт Telegram (телефон → код → пароль 2FA при
 * необходимости) для конкретной линии Открытых линий Bitrix24.
 */
export function TgPersonalConnectorClient({ lineId }: { lineId: string }) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (!lineId) {
    return (
      <p className="text-sm text-destructive">
        Откройте это окно из настроек канала на линии в Контакт-центре
        Битрикс24 — не удалось определить линию.
      </p>
    );
  }

  const submitPhone = () => {
    if (!phone.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await orpcClient.telegramPersonal.startLogin({
        lineId,
        phone: phone.trim(),
      });
      if (res.error || !res.loginId) {
        setError(res.error ?? "Не удалось отправить код");
        return;
      }
      setLoginId(res.loginId);
      setStep("code");
    });
  };

  const submitCode = () => {
    if (!loginId || !code.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await orpcClient.telegramPersonal.submitCode({
        loginId,
        code: code.trim(),
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.status === "password_required") {
        setStep("password");
        return;
      }
      setActivationError(res.activationError ?? null);
      setStep("connected");
    });
  };

  const submitPassword = () => {
    if (!loginId || !password) return;
    setError(null);
    startTransition(async () => {
      const res = await orpcClient.telegramPersonal.submitPassword({
        loginId,
        password,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setActivationError(res.activationError ?? null);
      setStep("connected");
    });
  };

  return (
    <div className="flex max-w-sm flex-col gap-4">
      <div>
        <p className="text-sm font-medium">Telegram — личный номер</p>
        <p className="text-xs text-muted-foreground">Линия {lineId}</p>
      </div>

      {step === "phone" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="tg-phone" className="text-xs text-muted-foreground">
            Номер телефона (в международном формате)
          </Label>
          <Input
            id="tg-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+79991234567"
            disabled={busy}
          />
          <Button onClick={submitPhone} disabled={busy || !phone.trim()}>
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            Отправить код
          </Button>
        </div>
      )}

      {step === "code" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="tg-code" className="text-xs text-muted-foreground">
            Код из Telegram/SMS
          </Label>
          <Input
            id="tg-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="12345"
            disabled={busy}
          />
          <Button onClick={submitCode} disabled={busy || !code.trim()}>
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            Подтвердить
          </Button>
        </div>
      )}

      {step === "password" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="tg-password" className="text-xs text-muted-foreground">
            Пароль двухфакторной аутентификации
          </Label>
          <Input
            id="tg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <Button onClick={submitPassword} disabled={busy || !password}>
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            Войти
          </Button>
        </div>
      )}

      {step === "connected" && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckIcon className="size-4" />
            Номер подключён к этой линии
          </p>
          {activationError && (
            <p className="text-sm text-destructive">
              Сессия сохранена, но активировать линию не удалось:{" "}
              {activationError}. Попробуйте открыть настройки канала ещё раз.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
