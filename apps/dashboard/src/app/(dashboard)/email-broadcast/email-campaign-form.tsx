"use client";

import type { UnisenderTemplate } from "@psi-opora/unisender-client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  EmailRecipientsReport,
  RecentEmailCampaignInfo,
} from "@psi-opora/api";
import { orpcClient } from "@/lib/orpc/client";
import { emailCampaignsListKey } from "./history";
import { RecipientsReport } from "./recipients-report";
import { SendConfirmation } from "./send-confirmation";

export interface StageOption {
  stageId: string;
  stageName: string;
  sort: number;
  categoryId: string;
  categoryName: string;
}

export function EmailCampaignForm({
  stages,
  templates,
  senderConfigured,
}: {
  stages: StageOption[];
  templates: UnisenderTemplate[];
  senderConfigured: boolean;
}) {
  const queryClient = useQueryClient();
  const [stageId, setStageId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const subjectTouchedRef = useRef(false);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [report, setReport] = useState<EmailRecipientsReport | null>(null);
  const [recentCampaign, setRecentCampaign] =
    useState<RecentEmailCampaignInfo | null>(null);
  const [previewSig, setPreviewSig] = useState<string | null>(null);
  const [reportKey, setReportKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    new Set(),
  );
  const [queued, setQueued] = useState<{
    campaignId: string;
    count: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categories = new Map<string, StageOption[]>();
  for (const stage of stages) {
    const list = categories.get(stage.categoryName) ?? [];
    list.push(stage);
    categories.set(stage.categoryName, list);
  }

  const selectedStage = stages.find((s) => s.stageId === stageId);
  const stageLabel = selectedStage
    ? `${selectedStage.categoryName} — ${selectedStage.stageName}`
    : stageId;
  const selectedTemplate = templates.find((t) => t.id === templateId);

  useEffect(() => {
    if (!templateId) {
      setPreviewBody(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    orpcClient.emailBroadcast.templatePreview({ templateId }).then((result) => {
      if (cancelled) return;
      setPreviewLoading(false);
      if (result.error) {
        setPreviewBody(null);
        return;
      }
      setPreviewBody(result.body ?? null);
      if (!subjectTouchedRef.current && result.subject) setSubject(result.subject);
    });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const trimmedSubject = subject.trim();
  const currentSig = JSON.stringify([stageId, templateId, trimmedSubject]);
  const previewFresh = report?.dryRun && previewSig === currentSig;
  const pendingRecipients = report
    ? report.recipients.filter((r) => r.status === "pending")
    : [];
  const sendableCount =
    selectedContactIds.size > 0
      ? pendingRecipients.filter((r) => selectedContactIds.has(r.contactId))
          .length
      : pendingRecipients.length;
  const canSend =
    previewFresh && sendableCount > 0 && trimmedSubject.length > 0;

  const toggleContact = (contactId: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const toggleManyContacts = (contactIds: string[], checked: boolean) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      for (const id of contactIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const sendHint = !senderConfigured
    ? "Не задан email отправителя — настройте на странице /settings/email."
    : !stageId
      ? "Выберите стадию сделки."
      : !templateId
        ? "Выберите шаблон письма."
        : !trimmedSubject
          ? "Введите тему письма."
          : !previewFresh
            ? report
              ? "Параметры изменились после предпросмотра — нажмите «Показать получателей» ещё раз."
              : "Отправка откроется после предпросмотра: нажмите «Показать получателей» и проверьте список."
            : sendableCount === 0
              ? "Среди получателей нет ни одного с email."
              : null;

  const runPreview = () => {
    setConfirming(false);
    setAckChecked(false);
    setQueued(null);
    setSelectedContactIds(new Set());
    startTransition(async () => {
      setError(null);
      const result = await orpcClient.emailBroadcast.send({
        stageId,
        stageName: stageLabel,
        templateId,
        templateName: selectedTemplate?.title,
        subject,
        dryRun: true,
      });
      if (result.error) {
        setError(result.error);
        setReport(null);
        setPreviewSig(null);
        setRecentCampaign(null);
      } else {
        setReport(result.report ?? null);
        setRecentCampaign(result.recentCampaign ?? null);
        setPreviewSig(currentSig);
        setReportKey((k) => k + 1);
      }
    });
  };

  const runSend = () => {
    if (!report) return;
    const expectedRecipients = report.recipients.length;
    setConfirming(false);
    setAckChecked(false);
    startTransition(async () => {
      setError(null);
      const result = await orpcClient.emailBroadcast.send({
        stageId,
        stageName: stageLabel,
        templateId,
        templateName: selectedTemplate?.title,
        subject,
        dryRun: false,
        expectedRecipients,
        selectedContactIds:
          selectedContactIds.size > 0 ? [...selectedContactIds] : undefined,
      });
      if (result.error) {
        setError(result.error);
      } else if (result.queuedCampaignId) {
        setQueued({
          campaignId: result.queuedCampaignId,
          count: result.queuedCount ?? 0,
        });
        setReport(null);
        setPreviewSig(null);
        queryClient.invalidateQueries({ queryKey: emailCampaignsListKey });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Параметры рассылки</CardTitle>
          <CardDescription>
            Письмо получит контакт каждой сделки на выбранной стадии — один
            раз, даже если сделок у контакта несколько. Отправка возможна
            только после предпросмотра списка получателей.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Стадия сделки
              </Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите стадию" />
                </SelectTrigger>
                <SelectContent>
                  {[...categories.entries()].map(([categoryName, list]) => (
                    <SelectGroup key={categoryName}>
                      <SelectLabel>{categoryName}</SelectLabel>
                      {list.map((stage) => (
                        <SelectItem key={stage.stageId} value={stage.stageId}>
                          {stage.stageName}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Шаблон Unisender
              </Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите шаблон" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={!stageId || !templateId || isPending}
                onClick={runPreview}
              >
                {isPending ? "Загрузка…" : "Показать получателей"}
              </Button>
              <Button
                disabled={!canSend || isPending || confirming}
                onClick={() => setConfirming(true)}
              >
                Отправить рассылку…
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subject" className="text-xs text-muted-foreground">
                Тема письма
              </Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  subjectTouchedRef.current = true;
                }}
                placeholder="Тема письма подтянется из шаблона — можно изменить"
              />
              {selectedTemplate?.screenshot_url && (
                <a
                  href={
                    selectedTemplate.fullsize_screenshot_url ??
                    selectedTemplate.screenshot_url
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground underline underline-offset-2 w-fit"
                >
                  Открыть миниатюру шаблона
                </a>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Как увидит клиент (превью шаблона)
              </Label>
              <div className="rounded-md border overflow-hidden bg-white h-64">
                {previewLoading ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    Загрузка превью…
                  </p>
                ) : previewBody ? (
                  <iframe
                    title="Превью письма"
                    srcDoc={previewBody}
                    sandbox=""
                    className="h-full w-full"
                  />
                ) : (
                  <p className="p-3 text-sm text-muted-foreground">
                    Выберите шаблон, чтобы увидеть превью.
                  </p>
                )}
              </div>
            </div>
          </div>

          {sendHint && !confirming && (
            <p className="text-xs text-muted-foreground">{sendHint}</p>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {queued && (
        <Card className="border-emerald-500/50">
          <CardHeader>
            <CardTitle>Рассылка запущена</CardTitle>
            <CardDescription>
              Импорт {queued.count} получателей в Unisender и запуск кампании
              выполняются в фоне — страницу можно закрыть. Статус появится на
              странице рассылки.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/email-broadcast/${queued.campaignId}`}>
                Открыть статус рассылки
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {confirming && previewFresh && report && (
        <SendConfirmation
          stageLabel={stageLabel}
          templateLabel={selectedTemplate?.title ?? templateId}
          subject={trimmedSubject}
          sendableCount={sendableCount}
          hasManualSelection={selectedContactIds.size > 0}
          skippedCount={report.skipped}
          recentCampaign={recentCampaign}
          ackChecked={ackChecked}
          onAckChange={setAckChecked}
          onConfirm={runSend}
          onCancel={() => {
            setConfirming(false);
            setAckChecked(false);
          }}
          isPending={isPending}
        />
      )}

      {report && (
        <RecipientsReport
          key={reportKey}
          report={report}
          subject={trimmedSubject}
          templateId={templateId}
          selectedIds={selectedContactIds}
          onToggle={toggleContact}
          onToggleMany={toggleManyContacts}
        />
      )}
    </div>
  );
}
