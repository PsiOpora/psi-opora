"use client";

import { EMAIL_IMPORT_BATCH_SIZE } from "@psi-opora/api/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { FileUpIcon, UploadIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
	type CsvDelimiter,
	decodeCsvBytes,
	detectDelimiter,
	downloadCsv,
	type ExtractedContact,
	type ExtractionResult,
	extractContacts,
	extractContactsFromText,
	guessColumns,
	parseCsv,
} from "@/lib/csv-import";
import { orpc, orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

/** Файлы больше этого размера не разбираем в браузере. */
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const NO_COLUMN = "none";

const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
	",": "Запятая ( , )",
	";": "Точка с запятой ( ; )",
	"\t": "Табуляция",
	"|": "Вертикальная черта ( | )",
};

interface ParsedFile {
	name: string;
	encoding: string;
	text: string;
	delimiter: CsvDelimiter;
	rows: string[][];
	hasHeader: boolean;
	emailColumn: number | null;
	phoneColumn: number | null;
	nameColumn: number | null;
}

type Stage =
	| { kind: "edit" }
	| { kind: "importing"; done: number; total: number }
	| {
			kind: "done";
			inserted: number;
			updated: number;
			invalid: string[];
			duplicates: number;
			conflicts: number;
			merged: number;
			failedBatches: number;
	  };

function columnLabel(file: ParsedFile, index: number): string {
	const header = file.hasHeader ? file.rows[0]?.[index]?.trim() : "";
	return header ? `${index + 1}. ${header}` : `Колонка ${index + 1}`;
}

export function ImportDialog({
	listId,
	listName,
}: {
	listId: string;
	listName: string;
}) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"file" | "text">("file");
	const [file, setFile] = useState<ParsedFile | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const [pasted, setPasted] = useState("");
	const [stage, setStage] = useState<Stage>({ kind: "edit" });
	const cancelRef = useRef(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const reset = () => {
		setFile(null);
		setFileError(null);
		setPasted("");
		setStage({ kind: "edit" });
		if (inputRef.current) inputRef.current.value = "";
	};

	const onFile = async (picked: File | undefined) => {
		setFileError(null);
		setFile(null);
		if (!picked) return;
		if (/\.(xlsx?|ods|numbers)$/i.test(picked.name)) {
			setFileError(
				"Это файл таблицы, а не CSV. Откройте его в Excel или Google Таблицах и сохраните как «CSV» (Файл → Сохранить как / Скачать).",
			);
			return;
		}
		if (picked.size > MAX_FILE_SIZE) {
			setFileError("Файл больше 20 МБ — разбейте его на несколько частей.");
			return;
		}
		const { text, encoding } = decodeCsvBytes(
			new Uint8Array(await picked.arrayBuffer()),
		);
		const delimiter = detectDelimiter(text);
		const rows = parseCsv(text, delimiter);
		if (rows.length === 0) {
			setFileError("Файл пустой.");
			return;
		}
		setFile({
			name: picked.name,
			encoding,
			text,
			delimiter,
			rows,
			...guessColumns(rows),
		});
	};

	const changeDelimiter = (delimiter: CsvDelimiter) => {
		if (!file) return;
		const rows = parseCsv(file.text, delimiter);
		setFile({ ...file, delimiter, rows, ...guessColumns(rows) });
	};

	const extraction: ExtractionResult | null = useMemo(() => {
		if (mode === "text") {
			return pasted.trim() ? extractContactsFromText(pasted) : null;
		}
		if (!file || (file.emailColumn === null && file.phoneColumn === null))
			return null;
		return extractContacts(file.rows, {
			hasHeader: file.hasHeader,
			emailColumn: file.emailColumn,
			phoneColumn: file.phoneColumn,
			nameColumn: file.nameColumn,
		});
	}, [mode, pasted, file]);

	const width = file
		? Math.max(0, ...file.rows.slice(0, 50).map((r) => r.length))
		: 0;
	// Номера колонок — стабильный ключ: колонки не переупорядочиваются.
	const columnIndexes = Array.from({ length: width }, (_, i) => i);
	const previewRows = file
		? file.rows.slice(file.hasHeader ? 1 : 0, (file.hasHeader ? 1 : 0) + 5)
		: [];

	const runImport = async () => {
		if (!extraction || extraction.contacts.length === 0) return;
		cancelRef.current = false;
		const contacts: ExtractedContact[] = extraction.contacts;
		const batches: ExtractedContact[][] = [];
		for (let i = 0; i < contacts.length; i += EMAIL_IMPORT_BATCH_SIZE) {
			batches.push(contacts.slice(i, i + EMAIL_IMPORT_BATCH_SIZE));
		}

		let inserted = 0;
		let updated = 0;
		let duplicates = extraction.duplicates;
		let conflicts = 0;
		let merged = 0;
		let failedBatches = 0;
		const invalid = [...extraction.invalid];
		setStage({ kind: "importing", done: 0, total: contacts.length });

		let done = 0;
		for (const batch of batches) {
			if (cancelRef.current) break;
			try {
				const result = await orpcClient.emailLists.importContacts({
					listId,
					source: mode === "file" ? "csv" : "manual",
					contacts: batch,
				});
				inserted += result.inserted;
				updated += result.updated;
				duplicates += result.duplicates;
				conflicts += result.conflicts;
				merged += result.merged;
				invalid.push(...result.invalid);
			} catch (err) {
				failedBatches++;
				toast.error(
					`Не удалось загрузить часть контактов: ${(err as Error).message}`,
				);
			}
			done += batch.length;
			setStage({ kind: "importing", done, total: contacts.length });
		}

		queryClient.invalidateQueries({ queryKey: orpc.emailLists.key() });
		setStage({
			kind: "done",
			inserted,
			updated,
			invalid,
			duplicates,
			conflicts,
			merged,
			failedBatches,
		});
	};

	const importing = stage.kind === "importing";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (importing) return; // не закрываем посреди загрузки
				setOpen(next);
				if (!next) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button>
					<UploadIcon />
					Импорт контактов
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Импорт в «{listName}»</DialogTitle>
					<DialogDescription>
						Дублей не будет: контакт, чей телефон или email уже есть в списке,
						дополнится новыми данными (имя, недостающий телефон или email).
						Некорректные значения и повторы внутри файла пропускаются.
					</DialogDescription>
				</DialogHeader>

				{stage.kind === "importing" && (
					<div className="flex flex-col gap-3 py-4">
						<p className="text-sm">
							Загружаем контакты… {stage.done.toLocaleString("ru-RU")} из{" "}
							{stage.total.toLocaleString("ru-RU")}
						</p>
						<Progress value={(stage.done / stage.total) * 100} />
						<div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									cancelRef.current = true;
								}}
							>
								Остановить
							</Button>
						</div>
					</div>
				)}

				{stage.kind === "done" && (
					<div className="flex flex-col gap-3 py-2 text-sm">
						<p className="text-base font-medium">Импорт завершён</p>
						<ul className="flex flex-col gap-1">
							<li>
								Добавлено новых контактов:{" "}
								<b>{stage.inserted.toLocaleString("ru-RU")}</b>
							</li>
							<li>
								Уже были в списке (обновлены):{" "}
								{stage.updated.toLocaleString("ru-RU")}
							</li>
							{stage.duplicates > 0 && (
								<li>Повторы внутри файла склеены: {stage.duplicates}</li>
							)}
							{stage.merged > 0 && (
								<li>
									Дубли в списке склеены (телефон был у одного контакта, email у
									другого): {stage.merged}
								</li>
							)}
							{stage.conflicts > 0 && (
								<li>
									Противоречат списку (у контакта уже другой телефон или email)
									— не изменены: {stage.conflicts}
								</li>
							)}
							{stage.invalid.length > 0 && (
								<li className="text-destructive">
									Некорректных значений пропущено: {stage.invalid.length}
								</li>
							)}
							{stage.failedBatches > 0 && (
								<li className="text-destructive">
									Не загрузились из-за ошибки пачек: {stage.failedBatches} —
									повторите импорт, дубли не появятся.
								</li>
							)}
						</ul>
						{stage.invalid.length > 0 && (
							<div>
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										downloadCsv(
											"invalid-contacts.csv",
											["Значение"],
											stage.invalid.map((v) => [v]),
										)
									}
								>
									Скачать список некорректных
								</Button>
							</div>
						)}
						<DialogFooter>
							<Button variant="outline" onClick={reset}>
								Загрузить ещё
							</Button>
							<Button
								onClick={() => {
									setOpen(false);
									reset();
								}}
							>
								Готово
							</Button>
						</DialogFooter>
					</div>
				)}

				{stage.kind === "edit" && (
					<>
						<Tabs
							value={mode}
							onValueChange={(value) => setMode(value as "file" | "text")}
						>
							<TabsList>
								<TabsTrigger value="file">Файл CSV</TabsTrigger>
								<TabsTrigger value="text">Вставить списком</TabsTrigger>
							</TabsList>

							<TabsContent value="file" className="flex flex-col gap-4">
								<label
									className={cn(
										"flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm hover:bg-muted/50",
										file && "py-3",
									)}
								>
									<FileUpIcon className="size-6 text-muted-foreground" />
									{file ? (
										<span>
											<b>{file.name}</b> ·{" "}
											{file.rows.length.toLocaleString("ru-RU")} строк ·
											кодировка {file.encoding.toUpperCase()} — выбрать другой
											файл
										</span>
									) : (
										<span>
											Выберите CSV-файл (Excel: «Сохранить как → CSV», Google
											Таблицы: «Скачать → CSV»)
										</span>
									)}
									<input
										ref={inputRef}
										type="file"
										accept=".csv,.tsv,.txt,text/csv,text/plain"
										className="sr-only"
										onChange={(e) => onFile(e.target.files?.[0])}
									/>
								</label>
								{fileError && (
									<p className="text-sm text-destructive" role="alert">
										{fileError}
									</p>
								)}

								{file && (
									<>
										<div className="grid grid-cols-1 gap-3 md:grid-cols-4">
											<div className="flex flex-col gap-1.5">
												<Label className="text-xs text-muted-foreground">
													Колонка с email
												</Label>
												<Select
													value={
														file.emailColumn === null
															? NO_COLUMN
															: String(file.emailColumn)
													}
													onValueChange={(v) =>
														setFile({
															...file,
															emailColumn: v === NO_COLUMN ? null : Number(v),
														})
													}
												>
													<SelectTrigger className="w-full">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value={NO_COLUMN}>Без email</SelectItem>
														{columnIndexes.map((i) => (
															<SelectItem key={i} value={String(i)}>
																{columnLabel(file, i)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
											<div className="flex flex-col gap-1.5">
												<Label className="text-xs text-muted-foreground">
													Колонка с телефоном
												</Label>
												<Select
													value={
														file.phoneColumn === null
															? NO_COLUMN
															: String(file.phoneColumn)
													}
													onValueChange={(v) =>
														setFile({
															...file,
															phoneColumn: v === NO_COLUMN ? null : Number(v),
														})
													}
												>
													<SelectTrigger className="w-full">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value={NO_COLUMN}>
															Без телефона
														</SelectItem>
														{columnIndexes.map((i) => (
															<SelectItem key={i} value={String(i)}>
																{columnLabel(file, i)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
											<div className="flex flex-col gap-1.5">
												<Label className="text-xs text-muted-foreground">
													Колонка с именем (для {"{{name}}"})
												</Label>
												<Select
													value={
														file.nameColumn === null
															? NO_COLUMN
															: String(file.nameColumn)
													}
													onValueChange={(v) =>
														setFile({
															...file,
															nameColumn: v === NO_COLUMN ? null : Number(v),
														})
													}
												>
													<SelectTrigger className="w-full">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value={NO_COLUMN}>Без имени</SelectItem>
														{columnIndexes.map((i) => (
															<SelectItem key={i} value={String(i)}>
																{columnLabel(file, i)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
											<div className="flex flex-col gap-1.5">
												<Label className="text-xs text-muted-foreground">
													Разделитель
												</Label>
												<Select
													value={file.delimiter}
													onValueChange={(v) =>
														changeDelimiter(v as CsvDelimiter)
													}
												>
													<SelectTrigger className="w-full">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{Object.entries(DELIMITER_LABELS).map(
															([value, label]) => (
																<SelectItem key={value} value={value}>
																	{label}
																</SelectItem>
															),
														)}
													</SelectContent>
												</Select>
											</div>
										</div>
										<div className="flex items-center gap-2 text-sm">
											<Checkbox
												id="csv-has-header"
												checked={file.hasHeader}
												onCheckedChange={(checked) =>
													setFile({ ...file, hasHeader: checked === true })
												}
											/>
											<Label htmlFor="csv-has-header" className="font-normal">
												Первая строка — заголовки колонок
											</Label>
										</div>

										<div className="max-h-56 overflow-auto rounded-md border">
											<Table>
												<TableHeader>
													<TableRow>
														{columnIndexes.map((i) => (
															<TableHead
																key={i}
																className={cn(
																	"whitespace-nowrap",
																	i === file.emailColumn &&
																		"bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
																	i === file.phoneColumn &&
																		"bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
																	i === file.nameColumn &&
																		"bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
																)}
															>
																{columnLabel(file, i)}
																{i === file.emailColumn && " · email"}
																{i === file.phoneColumn && " · телефон"}
																{i === file.nameColumn && " · имя"}
															</TableHead>
														))}
													</TableRow>
												</TableHeader>
												<TableBody>
													{previewRows.map((row, r) => (
														// biome-ignore lint/suspicious/noArrayIndexKey: строки превью не переупорядочиваются
														<TableRow key={r}>
															{columnIndexes.map((i) => (
																<TableCell
																	key={i}
																	className="max-w-48 truncate text-xs"
																>
																	{row[i] ?? ""}
																</TableCell>
															))}
														</TableRow>
													))}
												</TableBody>
											</Table>
										</div>
									</>
								)}
							</TabsContent>

							<TabsContent value="text" className="flex flex-col gap-2">
								<Textarea
									value={pasted}
									onChange={(e) => setPasted(e.target.value)}
									placeholder={
										"ivan@mail.ru\nПётр Петров <petr@mail.ru>\nАнна; +7 999 123-45-67; anna@mail.ru\n8 900 000-00-01"
									}
									className="min-h-48 font-mono text-xs"
								/>
								<p className="text-xs text-muted-foreground">
									По одному контакту в строке: email, телефон или оба сразу, имя
									— любым оставшимся текстом («Имя; телефон; адрес», «Имя
									&lt;адрес&gt;»). Можно вставить колонки прямо из таблицы.
								</p>
							</TabsContent>
						</Tabs>

						{extraction && (
							<div className="rounded-md bg-muted/50 p-3 text-sm">
								К загрузке:{" "}
								<b>{extraction.contacts.length.toLocaleString("ru-RU")}</b>{" "}
								контактов
								{extraction.duplicates > 0 &&
									` · повторов в файле: ${extraction.duplicates}`}
								{extraction.invalid.length > 0 && (
									<span className="text-destructive">
										{" "}
										· некорректных: {extraction.invalid.length} (например,{" "}
										{extraction.invalid.slice(0, 3).join(", ")})
									</span>
								)}
							</div>
						)}

						<DialogFooter>
							<Button variant="outline" onClick={() => setOpen(false)}>
								Отмена
							</Button>
							<Button
								onClick={runImport}
								disabled={!extraction || extraction.contacts.length === 0}
							>
								Загрузить{" "}
								{extraction?.contacts.length
									? extraction.contacts.length.toLocaleString("ru-RU")
									: ""}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
