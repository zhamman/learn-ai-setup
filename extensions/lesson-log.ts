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
 *   - orchestration tool results
 *
 * Human commands:
 *   /learn <dir>          Set the subject directory relative to cwd.
 *   /lesson <slug>        Manually start/switch a lesson note (escape hatch).
 *   /lesson-stop          Stop writing lesson notes.
 *   /lesson-status        Show current subject + lesson.
 *
 * Model tool:
 *   lesson_note({ topic }) — automatically start/switch notes at semantic topic boundaries.
 *
 * Example:
 *   /learn python/oop
 *   model calls lesson_note({ topic: "inheritance" })
 *
 * writes to:
 *   <cwd>/python/oop/inheritance.md
 *
 * The lesson file is created automatically if missing. If it already exists,
 * new material is appended so revisiting a topic enriches the same note.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

const QA_TOOLS = new Set(["quiz"]);

const LessonNoteParams = Type.Object({
	topic: Type.String({
		description:
			"Stable short topic slug for the distinct concept being taught, e.g. 'inheritance', 'self', 'agent-harness', or 'transaction-isolation'. Reuse the same slug when revisiting the same concept.",
	}),
	title: Type.Optional(
		Type.String({
			description:
			"Optional human-readable note title. Defaults to title-casing the topic slug. Use only when the natural title cannot be derived cleanly from the slug.",
		}),
	),
});

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

	function activateLesson(ctx: any, topicInput: string, titleInput?: string): { file: string; slug: string; created: boolean } | null {
		if (!subjectDir) {
			return null;
		}

		const slug = slugify(topicInput);
		if (!slug) return null;

		const file = path.join(subjectDir, `${slug}.md`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const created = !fs.existsSync(file);
		if (created) {
			const title = titleInput?.trim() || titleFromSlug(slug);
			fs.writeFileSync(file, `# ${title}\n`, "utf-8");
		}

		lessonSlug = slug;
		lessonFile = file;
		pi.appendEntry("lesson-log", { subjectDir, lessonFile, lessonSlug });

		if (ctx?.ui) {
			const theme = ctx.ui.theme;
			ctx.ui.setStatus(
				"lesson-log",
				theme.fg("accent", "📘 ") + theme.fg("dim", path.basename(file)),
			);
		}
		return { file, slug, created };
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
		description: "Manually start or switch to a topic-based lesson note",
		handler: async (args, ctx: any) => {
			if (!subjectDir) {
				ctx.ui.notify("Set a learning directory first with /learn <dir>", "warning");
				return;
			}
			const result = activateLesson(ctx, args.trim());
			if (!result) {
				ctx.ui.notify("Usage: /lesson <topic-slug>", "warning");
				return;
			}
			ctx.ui.notify(`Lesson note: ${result.file}`, "success");
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

	pi.registerTool({
		name: "lesson_note",
		label: "lesson note",
		description:
			"Switch the active Obsidian learning note to the distinct concept you are about to teach. The human sets the subject directory once with /learn; you call this tool automatically at semantic topic boundaries. The note is created if missing and reused if it already exists. Do NOT call it for every message, clarification, quiz, example, or researcher lookup. Call it when the knowledge graph moves to a genuinely distinct concept that deserves its own durable note.",
		promptSnippet:
			"When teaching and a /learn directory is configured, call lesson_note BEFORE the first substantive explanation of each distinct concept so lesson prose and quizzes land in the correct topic Markdown file.",
		promptGuidelines: [
			"The user controls the subject directory with /learn <dir>. Never silently choose or change the subject directory yourself.",
			"Before teaching the first distinct concept after the plan is approved, call lesson_note with a short stable topic slug.",
			"When moving to the next distinct concept/node in the teaching dependency graph, call lesson_note before explaining that new concept.",
			"Reuse the SAME topic slug when revisiting a concept. Do not create topic-2, topic-part-2, or date-based duplicates.",
			"Do not switch notes for clarifications, examples, quizzes, retries, researcher calls, or stylistic changes if the underlying concept is unchanged.",
			"Choose concept-sized notes: 'inheritance', 'self', 'agent-harness', 'transaction-isolation'. Avoid huge subject slugs like 'python' and tiny conversational slugs like 'example-1'.",
			"Once a lesson note is active, write teaching prose so it remains useful when read later without the surrounding chat. Avoid conversational filler and process commentary in lesson prose.",
		],
		parameters: LessonNoteParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!subjectDir) {
				return {
					content: [
						{
							type: "text",
							text: "No learning directory is configured. Ask the user to run /learn <subject-directory> once, then retry lesson_note.",
						},
					],
					details: { status: "no-subject" },
				};
			}

			const result = activateLesson(ctx, params.topic, params.title);
			if (!result) {
				return {
					content: [{ type: "text", text: "Invalid lesson topic. Use a short non-empty concept slug." }],
					details: { status: "invalid-topic" },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `${result.created ? "Created" : "Activated"} lesson note: ${result.file}`,
					},
				],
				details: {
					status: "active",
					file: result.file,
					topic: result.slug,
					created: result.created,
				},
			};
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

	// Quiz questions are logged from the post-shuffle update so Obsidian matches
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
