/**
 * Адаптер server action для нативного атрибута `action` формы.
 * React 19 типизирует `form.action` как `void | Promise<void>`, а проектные
 * экшены возвращают `ActionResult`. Обёртка позволяет передать результат в
 * `<form action>` без потери обработки ошибок внутри `SubmitButton`.
 */
export function asFormAction<T extends unknown[]>(
  action: (...args: T) => Promise<unknown> | unknown,
): (...args: T) => Promise<void> {
  return async (...args) => {
    await action(...args);
  };
}
