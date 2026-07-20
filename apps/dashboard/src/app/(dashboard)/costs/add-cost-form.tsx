"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type AddCostInput, addCostSchema } from "@psi-opora/api/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc/client";

const currentMonth = new Date().toISOString().slice(0, 7);

const defaultValues: AddCostInput = {
  month: currentMonth,
  utmSource: "",
  utmCampaign: "",
  amount: Number.NaN,
  note: "",
};

export function AddCostForm() {
  const queryClient = useQueryClient();

  const form = useForm<AddCostInput>({
    resolver: zodResolver(addCostSchema),
    defaultValues,
  });

  const mutation = useMutation(
    orpc.costs.add.mutationOptions({
      onSuccess: () => {
        toast.success("Расход добавлен");
        form.reset({ ...defaultValues, month: form.getValues("month") });
        queryClient.invalidateQueries({ queryKey: orpc.costs.list.key() });
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось добавить расход");
      },
    }),
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="flex flex-wrap items-end gap-3"
      >
        <FormField
          control={form.control}
          name="month"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                Месяц
              </FormLabel>
              <FormControl>
                <Input type="month" className="w-40" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="utmSource"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                UTM source
              </FormLabel>
              <FormControl>
                <Input placeholder="yandex" className="w-40" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="utmCampaign"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                UTM campaign (не обязательно)
              </FormLabel>
              <FormControl>
                <Input placeholder="promo-june" className="w-44" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                Сумма, ₽
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="1"
                  step="0.01"
                  className="w-32"
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={Number.isNaN(field.value) ? "" : field.value}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === ""
                        ? Number.NaN
                        : Number(e.target.value.replace(",", ".")),
                    )
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                Заметка
              </FormLabel>
              <FormControl>
                <Input placeholder="кабинет Директа" className="w-48" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Добавляем…" : "Добавить"}
        </Button>
      </form>
    </Form>
  );
}
