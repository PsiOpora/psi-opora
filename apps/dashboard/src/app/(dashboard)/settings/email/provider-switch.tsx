"use client";

import type { EmailProviderInput } from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/lib/orpc/client";

const PROVIDER_LABELS: Record<EmailProviderInput["provider"], string> = {
  rusender: "Rusender",
  unisender: "Unisender",
};

export function ProviderSwitch() {
  const queryClient = useQueryClient();
  const { data } = useQuery(orpc.email.getProvider.queryOptions());

  const mutation = useMutation(
    orpc.email.setProvider.mutationOptions({
      onSuccess: () => {
        toast.success("Провайдер отправки изменён");
        queryClient.invalidateQueries({
          queryKey: orpc.email.getProvider.key(),
        });
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось изменить провайдера");
      },
    }),
  );

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">
        Активный провайдер отправки
      </span>
      <Select
        value={data?.provider ?? "rusender"}
        onValueChange={(value) =>
          mutation.mutate({ provider: value as EmailProviderInput["provider"] })
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
