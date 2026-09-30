import { describe, expect, test } from "bun:test";
import {
	formatTelegramMessage,
	renderTelegramHtml,
	renderTelegramPlainText,
} from "./format";

describe("Telegram formatting", () => {
	test("renders common Markdown as Telegram-safe HTML", () => {
		const html = renderTelegramHtml(
			[
				"# Architecture",
				"**Nx/NestJS** with `gateway` and <unsafe>.",
				"",
				"```text",
				"Gateway --> Service < Queue",
				"```",
				"- [Repository](https://github.com/acme/api)",
			].join("\n"),
		);

		expect(html).toContain("<b>Architecture</b>");
		expect(html).toContain(
			"<b>Nx/NestJS</b> with <code>gateway</code> and &lt;unsafe&gt;.",
		);
		expect(html).toContain(
			'<pre><code class="language-text">Gateway --&gt; Service &lt; Queue</code></pre>',
		);
		expect(html).toContain(
			'• <a href="https://github.com/acme/api">Repository</a>',
		);
		expect(html).not.toContain("<unsafe>");
	});

	test("closes a fenced code block after truncation", () => {
		const message = formatTelegramMessage(`\`\`\`ts\n${"<value>".repeat(700)}`);

		expect(message.html).toStartWith('<pre><code class="language-ts">');
		expect(message.html).toEndWith("</code></pre>");
		expect(message.html).toContain("[truncated]");
		expect(message.html).not.toContain("<value>");
	});

	test("creates readable plain text for formatting fallback", () => {
		expect(
			renderTelegramPlainText(
				"# Title\n**Bold** and `code`\n- [Repo](https://github.com/acme/api)",
			),
		).toBe("Title\nBold and code\n• Repo (https://github.com/acme/api)");
	});
});
