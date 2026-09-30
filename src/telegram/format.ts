const telegramMessageLimit = 4_096;
const truncationSuffix = "\n\n[truncated]";

export type TelegramMessage = {
	html: string;
	plainText: string;
};

export function formatTelegramMessage(markdown: string): TelegramMessage {
	const limited = limitTelegramText(markdown);
	return {
		html: renderTelegramHtml(limited),
		plainText: renderTelegramPlainText(limited),
	};
}

export function limitTelegramText(text: string): string {
	if (text.length <= telegramMessageLimit) {
		return text;
	}

	return `${text.slice(0, telegramMessageLimit - truncationSuffix.length)}${truncationSuffix}`;
}

export function renderTelegramHtml(markdown: string): string {
	const output: string[] = [];
	let codeLines: string[] | undefined;
	let codeLanguage = "";

	for (const line of normalizeLines(markdown)) {
		if (codeLines) {
			if (/^\s*```\s*$/.test(line)) {
				output.push(renderCodeBlock(codeLines, codeLanguage));
				codeLines = undefined;
				codeLanguage = "";
			} else {
				codeLines.push(line);
			}
			continue;
		}

		const fence = line.match(/^\s*```([A-Za-z0-9_+-]*)\s*$/);
		if (fence) {
			codeLines = [];
			codeLanguage = fence[1] ?? "";
			continue;
		}

		output.push(renderBlockLine(line));
	}

	if (codeLines) {
		output.push(renderCodeBlock(codeLines, codeLanguage));
	}

	return output.join("\n");
}

export function renderTelegramPlainText(markdown: string): string {
	return normalizeLines(markdown)
		.filter((line) => !/^\s*```[A-Za-z0-9_+-]*\s*$/.test(line))
		.map((line) =>
			line
				.replace(/^\s{0,3}#{1,6}\s+/, "")
				.replace(/^\s*[-+*]\s+/, "• ")
				.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
				.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
				.replace(/(\*\*|__|~~|`)/g, ""),
		)
		.join("\n");
}

function normalizeLines(text: string): string[] {
	return text.replace(/\r\n?/g, "\n").split("\n");
}

function renderBlockLine(line: string): string {
	const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
	if (heading) {
		return `<b>${renderInline(heading[1] ?? "")}</b>`;
	}

	const quote = line.match(/^\s*>\s?(.*)$/);
	if (quote) {
		return `<blockquote>${renderInline(quote[1] ?? "")}</blockquote>`;
	}

	const bullet = line.match(/^\s*[-+*]\s+(.*)$/);
	if (bullet) {
		return `• ${renderInline(bullet[1] ?? "")}`;
	}

	return renderInline(line);
}

function renderCodeBlock(lines: string[], language: string): string {
	const className = language ? ` class="language-${language}"` : "";
	return `<pre><code${className}>${escapeHtml(lines.join("\n"))}</code></pre>`;
}

function renderInline(text: string, depth = 0): string {
	if (depth > 4) {
		return escapeHtml(text);
	}

	let output = "";
	let index = 0;
	while (index < text.length) {
		if (text[index] === "\\" && index + 1 < text.length) {
			output += escapeHtml(text[index + 1] ?? "");
			index += 2;
			continue;
		}

		const code = readDelimited(text, index, "`");
		if (code) {
			output += `<code>${escapeHtml(code.content)}</code>`;
			index = code.nextIndex;
			continue;
		}

		const bold =
			readDelimited(text, index, "**") ?? readDelimited(text, index, "__");
		if (bold) {
			output += `<b>${renderInline(bold.content, depth + 1)}</b>`;
			index = bold.nextIndex;
			continue;
		}

		const strike = readDelimited(text, index, "~~");
		if (strike) {
			output += `<s>${renderInline(strike.content, depth + 1)}</s>`;
			index = strike.nextIndex;
			continue;
		}

		const link = readLink(text, index);
		if (link) {
			const label = renderInline(link.label, depth + 1);
			output += link.href
				? `<a href="${escapeHtml(link.href)}">${label}</a>`
				: `${label} (${escapeHtml(link.rawHref)})`;
			index = link.nextIndex;
			continue;
		}

		const italic = readDelimited(text, index, "*");
		if (italic) {
			output += `<i>${renderInline(italic.content, depth + 1)}</i>`;
			index = italic.nextIndex;
			continue;
		}

		output += escapeHtml(text[index] ?? "");
		index += 1;
	}

	return output;
}

function readDelimited(
	text: string,
	index: number,
	marker: string,
): { content: string; nextIndex: number } | undefined {
	if (!text.startsWith(marker, index)) {
		return undefined;
	}

	const closingIndex = text.indexOf(marker, index + marker.length);
	if (closingIndex <= index + marker.length) {
		return undefined;
	}

	return {
		content: text.slice(index + marker.length, closingIndex),
		nextIndex: closingIndex + marker.length,
	};
}

function readLink(
	text: string,
	index: number,
):
	| { label: string; href?: string; rawHref: string; nextIndex: number }
	| undefined {
	if (text[index] !== "[") {
		return undefined;
	}

	const labelEnd = text.indexOf("](", index + 1);
	if (labelEnd === -1) {
		return undefined;
	}

	const hrefEnd = text.indexOf(")", labelEnd + 2);
	if (hrefEnd === -1) {
		return undefined;
	}

	const rawHref = text.slice(labelEnd + 2, hrefEnd).trim();
	return {
		label: text.slice(index + 1, labelEnd),
		href: normalizeLink(rawHref),
		rawHref,
		nextIndex: hrefEnd + 1,
	};
}

function normalizeLink(value: string): string | undefined {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
