"use client";

import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  HelpCircleIcon,
  Loader2Icon,
  SendIcon,
} from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { orpcClient } from "@/lib/orpc/client";

type Step = "credentials" | "code" | "password" | "connected";

/** Bitrix24 открывает настройки коннектора в узком окне фиксированной
 * высоты (~204px) — макет ниже специально плотный: без подписей над
 * полями (только placeholder), справка — во всплывающей подсказке,
 * которая не занимает место в потоке. */
function ApiCredentialsHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Где взять api_id и api_hash"
        >
          <HelpCircleIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="text-xs">
        <p>
          <b>api_id</b> и <b>api_hash</b> — реквизиты приложения Telegram для
          номера, который вы подключаете (не аккаунта Bitrix24).
        </p>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>
            Откройте{" "}
            <a
              href="https://my.telegram.org/apps"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              my.telegram.org/apps
            </a>{" "}
            и войдите под этим номером телефона.
          </li>
          <li>Создайте приложение (любые название и платформа).</li>
          <li>Скопируйте App api_id и App api_hash в поля ниже.</li>
        </ol>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Пошаговый вход в личный аккаунт Telegram (api_id/api_hash + телефон → код
 * → пароль 2FA при необходимости) для конкретной линии Открытых линий Bitrix24.
 */
export function TgPersonalConnectorClient({
  lineId,
  connectorId,
}: {
  lineId: string;
  connectorId: string;
}) {
  const [step, setStep] = useState<Step>("credentials");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (!lineId || !connectorId) {
    return (
      <p className="text-xs text-destructive">
        Откройте это окно из настроек канала на линии в Контакт-центре —
        не удалось определить линию или коннектор.
      </p>
    );
  }

  const credentialsValid =
    /^\d+$/.test(apiId.trim()) && apiHash.trim().length > 0 && phone.trim().length >= 5;

  const submitCredentials = () => {
    if (!credentialsValid) return;
    setError(null);
    startTransition(async () => {
      const res = await orpcClient.telegramPersonal.startLogin({
        lineId,
        connectorId,
        phone: phone.trim(),
        apiId: apiId.trim(),
        apiHash: apiHash.trim(),
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
    <div className="flex flex-col gap-1.5">
      {step === "credentials" && (
        <>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SendIcon className="size-3.5" />
              Личный номер Telegram
            </span>
            <ApiCredentialsHelp />
          </div>
          <div className="flex gap-1.5">
            <Input
              value={apiId}
              onChange={(e) => setApiId(e.target.value)}
              placeholder="api_id"
              inputMode="numeric"
              aria-label="api_id"
              disabled={busy}
              className="w-20"
            />
            <Input
              value={apiHash}
              onChange={(e) => setApiHash(e.target.value)}
              placeholder="api_hash"
              aria-label="api_hash"
              disabled={busy}
              className="flex-1"
            />
          </div>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+79991234567"
            aria-label="Номер телефона"
            disabled={busy}
          />
          <Button
            size="sm"
            onClick={submitCredentials}
            disabled={busy || !credentialsValid}
          >
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}
            Отправить код
          </Button>
        </>
      )}

      {step === "code" && (
        <>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Код из Telegram/SMS"
            aria-label="Код из Telegram/SMS"
            disabled={busy}
            autoFocus
          />
          <Button size="sm" onClick={submitCode} disabled={busy || !code.trim()}>
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}
            Подтвердить
          </Button>
        </>
      )}

      {step === "password" && (
        <>
          <div className="relative">
            <Input
              type={passwordVisible ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль 2FA"
              aria-label="Пароль двухфакторной аутентификации"
              disabled={busy}
              autoFocus
              className="pr-8"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1"
              aria-label={passwordVisible ? "Скрыть пароль" : "Показать пароль"}
              onClick={() => setPasswordVisible((v) => !v)}
            >
              {passwordVisible ? (
                <EyeOffIcon className="size-3.5" />
              ) : (
                <EyeIcon className="size-3.5" />
              )}
            </Button>
          </div>
          <Button size="sm" onClick={submitPassword} disabled={busy || !password}>
            {busy && <Loader2Icon className="size-3.5 animate-spin" />}
            Войти
          </Button>
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

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
