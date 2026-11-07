import type { ReactNode } from "react";
import { parseRichText } from "./rich-text-parse";

const LINK_CLASS = "underline underline-offset-2 break-all hover:opacity-80";

/** Безопасный рендер текста сообщения без dangerouslySetInnerHTML — разбор
 * и правила разметки см. в rich-text-parse.ts. */
export function RichText({
	text,
	markup,
}: {
	text: string;
	/** Разбирать ли разметку (жирный, курсив, код) — только для сообщений оператора. */
	markup: boolean;
}) {
	const nodes: ReactNode[] = parseRichText(text, markup).map((token, index) => {
		const key = `t${index}`;
		switch (token.type) {
			case "link":
				return (
					<a
						key={key}
						href={token.href}
						target="_blank"
						rel="noopener noreferrer"
						className={LINK_CLASS}
					>
						{token.text}
					</a>
				);
			case "code":
				return (
					<code
						key={key}
						className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]"
					>
						{token.text}
					</code>
				);
			case "bold":
				return <strong key={key}>{token.text}</strong>;
			case "italic":
				return <em key={key}>{token.text}</em>;
			default:
				return token.text;
		}
	});
	return <>{nodes}</>;
}
