"use client";

import { CheckIcon, Loader2Icon, MessageCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orpcClient } from "@/lib/orpc/client";

type Step = "phone" | "code" | "connected";

export function MaxPersonalConnectorClient({
	lineId,
	connectorId,
}: {
	lineId: string;
	connectorId: string;
}) {
	const [step, setStep] = useState<Step>("phone");
	const [phone, setPhone] = useState("");
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
		if (phone.trim().length < 5) return;
		setError(null);
		startTransition(async () => {
			const result = await orpcClient.maxPersonal.startLogin({
				lineId,
				connectorId,
				phone: phone.trim(),
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
						value={phone}
						onChange={(event) => setPhone(event.target.value)}
						placeholder="+79991234567"
						disabled={busy}
						autoFocus
					/>
					<Button
						size="sm"
						onClick={submitPhone}
						disabled={busy || phone.trim().length < 5}
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
