/**
 * lesson-log — write clean, topic-based learning notes for Obsidian.
 *
 * Unlike md-log, this is NOT a transcript mirror. It records only:
 *   - assistant lesson prose while a lesson is active
 *   - quiz questions
 *   - quiz answers + explanations
 *
 * It intentionally omits:
 *   - ordinary user chat
 *   - bash/read/write/edit chatter
 *   - researcher/subagent chatter
 *   - orchestration details
 *
 * Commands:
 *   /learn <dir>          Set the subject directory relative to cwd.
 *   /lesson <slug>        Start/switch the active lesson note.
 *   /lesson-stop          Stop writing lesson notes.
 *   /lesson-status        Show current subject + lesson.
 *
 * Example:
 *   /learn python/oop
 *   /lesson inheritance
 *
 * writes to:
 *   <cwd>/python/oop/inheritance.md
 *
 * The lesson file is created automatically if missing. If it already exists,
 * new material is appended so revisiting a topic enriches the same note.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

const QA_TOOLS = new Set(["quiz"]);

function slugify(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug: string): string {
	return slug
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function callout(type: string, title: string, bodyLines: string[]): string {
	const lines = [`> [!${type}] ${title}`];
	for (const line of bodyLines) {
		lines.push(line.length === 0 ? ">" : `> ${line}`);
	}
	return lines.join("\n");
}

export default function lessonLog(pi: ExtensionAPI) {
	let subjectDir: string | null = null;
	let lessonFile: string | null = null;
	let lessonSlug: string | null = null;

	let writeLock: Promise<void> = Promise.resolve();
	function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const prev = writeLock;
		let release!: () => void;
		writeLock = new Promise<void>((r) => {
			release = r;
		});
		return prev.then(fn).finally(() => release());
	}

	function append(text: string): void {
		if (!lessonFile) return;
		fs.mkdirSync(path.dirname(lessonFile), { recursive: true });
		let current = "";
		if (fs.existsSync(lessonFile)) {
			current = fs.readFileSync(lessonFile, "utf-8");
		}
		const prefix = current.trim().length > 0 ? "\n\n" : "";
		fs.writeFileSync(lessonFile, current + prefix + text.trim() + "\n", "utf-8");
	}

	function ensureLessonFile(ctx: any, slugInput: string): string | null {
		if (!subjectDir) {
			ctx.ui.notify("Set a learning directory first with /learn <dir>", "warning");
			return null;
		}

		const slug = slugify(slugInput);
		if (!slug) {
			ctx.ui.notify("Usage: /lesson <topic-slug>", "warning");
			return null;
		}

		const file = path.join(subjectDir, `${slug}.md`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		if (!fs.existsSync(file)) {
			fs.writeFileSync(file, `# ${titleFromSlug(slug)}\n`, "utf-8");
		}

		lessonSlug = slug;
		lessonFile = file;
		pi.appendEntry("lesson-log", { subjectDir, lessonFile, lessonSlug });

		const theme = ctx.ui.theme;
		ctx.ui.setStatus(
			"lesson-log",
			theme.fg("accent", "📘 ") + theme.fg("dim", path.basename(file)),
		);
		ctx.ui.notify(`Lesson note: ${file}`, "success");
		return file;
	}

	pi.on("session_start", async (_event, ctx: any) => {
		let last: { subjectDir?: string | null; lessonFile?: string | null; lessonSlug?: string | null } | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "lesson-log") {
				last = entry.data as any;
			}
		}
		if (last?.subjectDir) subjectDir = last.subjectDir;
		if (last?.lessonFile && fs.existsSync(last.lessonFile)) {
			lessonFile = last.lessonFile;
			lessonSlug = last.lessonSlug ?? path.basename(last.lessonFile, ".md");
			const theme = ctx.ui.theme;
			ctx.ui.setStatus(
				"lesson-log",
				theme.fg("accent", "📘 ") + theme.fg("dim", path.basename(lessonFile)),
			);
		}
	});

	pi.registerCommand("learn", {
		description: "Set the learning subject directory used by topic notes",
		handler: async (args, ctx: any) => {
			const raw = args.trim();
			if (!raw) {
				ctx.ui.notify("Usage: /learn <directory>", "warning");
				return;
			}
			const resolved = path.isAbsolute(raw) ? raw : path.resolve(ctx.cwd, raw);
			fs.mkdirSync(resolved, { recursive: true });
			subjectDir = resolved;
			lessonFile = null;
			lessonSlug = null;
			pi.appendEntry("lesson-log", { subjectDir, lessonFile: null, lessonSlug: null });
			ctx.ui.setStatus("lesson-log", undefined);
			ctx.ui.notify(`Learning directory: ${resolved}`, "success");
		},
	});

	pi.registerCommand("lesson", {
		description: "Start or switch to a topic-based lesson note",
		handler: async (args, ctx: any) => {
			ensureLessonFile(ctx, args.trim());
		},
	});

	pi.registerCommand("lesson-stop", {
		description: "Stop writing to the active lesson note",
		handler: async (_args, ctx: any) => {
			lessonFile = null;
			lessonSlug = null;
			pi.appendEntry("lesson-log", { subjectDir, lessonFile: null, lessonSlug: null });
			ctx.ui.setStatus("lesson-log", undefined);
			ctx.ui.notify("Lesson logging stopped", "info");
		},
	});

	pi.registerCommand("lesson-status", {
		description: "Show current learning directory and active lesson note",
		handler: async (_args, ctx: any) => {
			ctx.ui.notify(
				`Learning directory: ${subjectDir ?? "(not set)"}\nLesson: ${lessonFile ?? "(not active)"}`,
				"info",
			);
		},
	});

	// Only assistant prose is mirrored. User messages are intentionally omitted.
	pi.on("message_end", async (event, _ctx) => {
		if (!lessonFile) return;
		const msg: any = event.message;
		if (!msg || msg.role !== "assistant") return;
		const textParts = (msg.content || [])
			.filter((c: any) => c.type === "text")
			.map((c: any) => String(c.text || "").trim())
			.filter((t: string) => t.length > 0);
		if (textParts.length === 0) return;
		await withLock(() => append(textParts.join("\n\n")));
	});

	// quiz questions are logged from the post-shuffle update so Obsidian matches
	// exactly what the learner saw in the terminal.
	const loggedQuizQuestion = new Set<string>();
	pi.on("tool_execution_update", async (event, _ctx) => {
		if (!lessonFile) return;
		const toolName = (event as any).toolName;
		if (toolName !== "quiz") return;
		const toolCallId = (event as any).toolCallId;
		if (loggedQuizQuestion.has(toolCallId)) return;
		const shuffled = (event as any).partialResult?.details?.options as Array<{ index: number; label: string }> | undefined;
		if (!shuffled || shuffled.length === 0) return;
		loggedQuizQuestion.add(toolCallId);

		const input = (event as any).args || {};
		const question: string = input.question || "";
		const details: string | undefined = input.details?.trim() || undefined;
		const body: string[] = [];
		for (const line of question.split("\n")) body.push(line);
		if (details) {
			body.push("");
			for (const line of details.split("\n")) body.push(line);
		}
		body.push("");
		for (const o of shuffled) body.push(`${o.index}. ${o.label}`);

		await withLock(() => append(callout("question", "Quiz", body)));
	});

	pi.on("tool_result", async (event, _ctx) => {
		if (!lessonFile) return;
		const toolName = (event as any).toolName;
		if (!QA_TOOLS.has(toolName)) return;
		const details: any = (event as any).details;

		if (details?.status === "cancelled") {
			await withLock(() => append(callout("warning", "Quiz — skipped", ["(user skipped)"])));
			return;
		}
		if (details?.status === "unavailable") {
			await withLock(() => append(callout("warning", "Quiz — unavailable", [details?.message || ""])));
			return;
		}

		const dontKnow = details?.dontKnow === true;
		const correct = details?.correct === true;
		const type = dontKnow ? "question" : correct ? "success" : "failure";
		const title = dontKnow ? "Quiz — I don't know" : correct ? "Quiz — correct ✓" : "Quiz — incorrect ✗";
		const body: string[] = [];

		if (dontKnow) {
			body.push("Your answer: I don't know");
		} else {
			const answers: any[] = details?.answers || [];
			const selected = answers.map((a) => `${a.index}. ${a.label}`).join(", ") || "(none)";
			body.push(`Your answer: ${selected}`);
		}

		const correctIndices: number[] = details?.correctIndices || [];
		if (correctIndices.length > 0) body.push(`Correct answer: ${correctIndices.join(", ")}`);
		if (details?.note) {
			body.push("");
			body.push(`Note: ${String(details.note)}`);
		}
		if (details?.explanation) {
			body.push("");
			for (const line of String(details.explanation).split("\n")) body.push(line);
		}

		await withLock(() => append(callout(type, title, body)));
	});
}
