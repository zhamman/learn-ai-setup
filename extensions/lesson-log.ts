/**
 * lesson-log — write clean, topic-based learning notes for Obsidian.
 *
 * This is NOT a transcript mirror.
 *
 * Durable lesson prose is written only when the model deliberately calls
 * `lesson_write`. Quiz questions/results are captured automatically, but they
 * are buffered until the quiz finishes so an in-flight `lesson_write` can land
 * first. This preserves lesson -> quiz ordering in the note.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

const LessonNoteParams = Type.Object({
	topic: Type.String({
		description:
			"Stable short topic slug for the distinct concept being taught, e.g. 'inheritance', 'self', 'agent-harness', or 'transaction-isolation'. Reuse the same slug when revisiting the same concept.",
	}),
	title: Type.Optional(
		Type.String({
			description:
			"Optional human-readable note title. Defaults to title-casing the topic slug.",
		}),
	),
});

const LessonWriteParams = Type.Object({
	content: Type.String({
		description:
			"Clean standalone Markdown worth preserving in the active concept note. Write durable knowledge only — never conversational filler, process commentary, or a transcript.",
	}),
});

type PendingQuiz = {
	file: string;
	questionBlock: string;
};

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

function buildQuizQuestionBlock(
	question: string,
	context: string | undefined,
	options: Array<{ index: number; label: string }>,
): string {
	const body: string[] = [];
	for (const line of question.split("\n")) body.push(line);
	if (context) {
		body.push("");
		for (const line of context.split("\n")) body.push(line);
	}
	if (options.length > 0) {
		body.push("");
		for (const option of options) body.push(`${option.index}. ${option.label}`);
	}
	return callout("question", "Quiz", body);
}

function buildQuizResultBlock(details: any): string {
	if (details?.status === "cancelled") {
		return callout("warning", "Quiz — skipped", ["(user skipped)"]);
	}

	if (details?.status === "unavailable") {
		return callout("warning", "Quiz — unavailable", [details?.message || ""]);
	}

	const dontKnow = details?.dontKnow === true;
	const correct = details?.correct === true;
	const type = dontKnow ? "question" : correct ? "success" : "failure";
	const title = dontKnow
		? "Quiz — I don't know"
		: correct
			? "Quiz — correct ✓"
			: "Quiz — incorrect ✗";
	const body: string[] = [];

	if (dontKnow) {
		body.push("Your answer: I don't know");
	} else {
		const answers: any[] = details?.answers || [];
		const selected = answers.map((a) => `${a.index}. ${a.label}`).join(", ") || "(none)";
		body.push(`Your answer: ${selected}`);
	}

	const correctIndices: number[] = details?.correctIndices || [];
	if (correctIndices.length > 0) {
		body.push(`Correct answer: ${correctIndices.join(", ")}`);
	}

	if (details?.note) {
		body.push("");
		body.push(`Note: ${String(details.note)}`);
	}

	if (details?.explanation) {
		body.push("");
		for (const line of String(details.explanation).split("\n")) body.push(line);
	}

	return callout(type, title, body);
}

export default function lessonLog(pi: ExtensionAPI) {
	let subjectDir: string | null = null;
	let lessonFile: string | null = null;
	let lessonSlug: string | null = null;

	// Quiz questions are held here until their result arrives. Previously the
	// question was appended as soon as the quiz UI opened, which could race ahead
	// of a lesson_write call from the same teaching step.
	const pendingQuizzes = new Map<string, PendingQuiz>();

	let writeLock: Promise<void> = Promise.resolve();
	function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const prev = writeLock;
		let release!: () => void;
		writeLock = new Promise<void>((r) => {
			release = r;
		});
		return prev.then(fn).finally(() => release());
	}

	function appendToFile(file: string, text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;

		fs.mkdirSync(path.dirname(file), { recursive: true });
		let current = "";
		if (fs.existsSync(file)) {
			current = fs.readFileSync(file, "utf-8");
		}
		const prefix = current.trim().length > 0 ? "\n\n" : "";
		fs.writeFileSync(file, current + prefix + trimmed + "\n", "utf-8");
	}

	function activateLesson(
		ctx: any,
		topicInput: string,
		titleInput?: string,
	): { file: string; slug: string; created: boolean } | null {
		if (!subjectDir) return null;

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
		let last:
			| { subjectDir?: string | null; lessonFile?: string | null; lessonSlug?: string | null }
			| undefined;

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
			"Switch the active Obsidian learning note to the distinct concept you are about to teach. The human sets the subject directory once with /learn. The note is created if missing and reused if it already exists. Activating a note does NOT save ordinary assistant messages; use lesson_write for durable lesson material.",
		promptSnippet:
			"When teaching and a /learn directory is configured, call lesson_note BEFORE the first substantive explanation of each distinct concept, then use lesson_write to save only curated standalone teaching material.",
		promptGuidelines: [
			"The user controls the subject directory with /learn <dir>. Never silently choose or change the subject directory yourself.",
			"Before teaching a distinct concept, call lesson_note with a short stable topic slug.",
			"Reuse the SAME topic slug when revisiting a concept.",
			"Do not switch notes for clarifications, examples, quizzes, retries, researcher calls, or stylistic changes if the underlying concept is unchanged.",
			"Choose concept-sized notes: 'inheritance', 'self', 'agent-harness', 'transaction-isolation'.",
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

	pi.registerTool({
		name: "lesson_write",
		label: "lesson write",
		description:
			"Append intentionally curated, durable Markdown to the currently active concept note. Use this for standalone explanations, important examples, key distinctions, mental models, and useful diagram markup. Ordinary assistant messages are NOT saved automatically. Quiz questions and results are captured automatically and should not be duplicated with lesson_write.",
		promptSnippet:
			"Use lesson_write to save only the durable knowledge from your teaching. If a quiz follows, complete lesson_write first; do not intentionally quiz before the durable explanation has been saved.",
		promptGuidelines: [
			"Call lesson_write only when there is durable knowledge worth keeping.",
			"Write standalone Markdown that makes sense without the surrounding conversation.",
			"Prefer the distilled explanation over copying your chat response verbatim.",
			"Do not save conversational filler, subagent process commentary, or tool-call details.",
			"Do not duplicate quiz content; quiz questions and results are logged automatically.",
			"When a quiz follows an explanation, finish lesson_write before invoking the quiz. Avoid issuing lesson_write and quiz as intentionally parallel work.",
			"If the current concept changes, call lesson_note first.",
		],
		parameters: LessonWriteParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!lessonFile) {
				return {
					content: [
						{
							type: "text",
							text: "No active lesson note. Call lesson_note for the current concept first.",
						},
					],
					details: { status: "no-lesson" },
				};
			}

			const content = params.content.trim();
			if (!content) {
				return {
					content: [{ type: "text", text: "Nothing written: lesson content was empty." }],
					details: { status: "empty" },
				};
			}

			const target = lessonFile;
			await withLock(() => appendToFile(target, content));

			return {
				content: [{ type: "text", text: `Saved durable lesson material to ${target}` }],
				details: {
					status: "written",
					file: target,
					topic: lessonSlug,
				},
			};
		},
	});

	// Capture the true post-shuffle quiz question, but do NOT write it yet.
	// Waiting until tool_result prevents the question from racing ahead of a
	// lesson_write call that belongs before it.
	pi.on("tool_execution_update", async (event, _ctx) => {
		if (!lessonFile) return;
		if ((event as any).toolName !== "quiz") return;

		const toolCallId = String((event as any).toolCallId || "");
		if (!toolCallId || pendingQuizzes.has(toolCallId)) return;

		const options = (event as any).partialResult?.details?.options as
			| Array<{ index: number; label: string }>
			| undefined;
		if (!options || options.length === 0) return;

		const input = (event as any).args || {};
		const question = String(input.question || "");
		const context = input.details?.trim() || undefined;

		pendingQuizzes.set(toolCallId, {
			file: lessonFile,
			questionBlock: buildQuizQuestionBlock(question, context, options),
		});
	});

	// Write the question + result as one ordered unit only after the learner has
	// answered. By then, a preceding lesson_write has had time to complete.
	pi.on("tool_result", async (event, _ctx) => {
		if ((event as any).toolName !== "quiz") return;

		const toolCallId = String((event as any).toolCallId || "");
		const details: any = (event as any).details || {};
		const pending = toolCallId ? pendingQuizzes.get(toolCallId) : undefined;

		const target = pending?.file ?? lessonFile;
		if (!target) return;

		let questionBlock = pending?.questionBlock;
		if (!questionBlock) {
			const options: Array<{ index: number; label: string }> = Array.isArray(details?.options)
				? details.options
				: [];
			questionBlock = buildQuizQuestionBlock(
				String(details?.question || ""),
				details?.context?.trim() || undefined,
				options,
			);
		}

		const resultBlock = buildQuizResultBlock(details);
		await withLock(() => appendToFile(target, `${questionBlock}\n\n${resultBlock}`));

		if (toolCallId) pendingQuizzes.delete(toolCallId);
	});
}
