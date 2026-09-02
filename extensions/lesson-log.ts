/**
 * lesson-log — keep learning plans, clean topic notes, and quiz history separate for Obsidian.
 *
 * Subject layout:
 *   <subject>/plan/<lesson>.md
 *   <subject>/topic/<concept>.md
 *   <subject>/quiz/<lesson>-diagnostic.md
 *   <subject>/quiz/<concept>-lesson.md
 *
 * Plans are maintained through `lesson_plan`.
 * Durable lesson prose is written only through `lesson_write`.
 * Quiz questions/results are captured automatically into the active quiz file.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

type QuizPhase = "diagnostic" | "lesson";

type PendingQuiz = {
	file: string;
	slug: string;
	phase: QuizPhase;
	questionBlock: string;
};

type LessonState = {
	subjectDir?: string | null;
	planFile?: string | null;
	planSlug?: string | null;
	lessonFile?: string | null;
	lessonSlug?: string | null;
	quizFile?: string | null;
	quizSlug?: string | null;
	quizPhase?: QuizPhase | null;
};

const LessonPlanParams = Type.Object({
	topic: Type.String({
		description:
			"Stable slug for the overall learning track, e.g. 'context-engineering', 'python-oop', or 'database-transactions'. Reuse the same slug whenever updating the same plan.",
	}),
	title: Type.Optional(
		Type.String({
			description:
			"Optional human-readable plan title. Defaults to title-casing the topic slug. Do not include 'Learning Plan'; the extension adds that suffix.",
		}),
	),
	content: Type.String({
		description:
			"The complete current plan body as standalone Markdown. Include the goal, diagnostic-informed starting point, dependency map/sequence, progress, current position, and next step. This replaces the previous body so the file remains a current plan rather than an append-only history.",
	}),
});

const LessonNoteParams = Type.Object({
	topic: Type.String({
		description:
			"Stable short concept slug, e.g. 'inheritance', 'context-window', or 'agent-harness'. Reuse the same slug when revisiting the same concept.",
	}),
	title: Type.Optional(
		Type.String({
			description: "Optional human-readable note title. Defaults to title-casing the topic slug.",
		}),
	),
});

const LessonWriteParams = Type.Object({
	content: Type.String({
		description:
			"Clean standalone Markdown worth preserving in the active concept note. Write durable knowledge only — never conversational filler, process commentary, quiz content, or a transcript.",
	}),
});

const LessonQuizContextParams = Type.Object({
	topic: Type.String({
		description:
			"Stable slug for the thing being assessed. For the opening knowledge check, use the overall requested lesson/topic, e.g. 'context-engineering'.",
	}),
	phase: Type.Union([Type.Literal("diagnostic"), Type.Literal("lesson")], {
		description:
			"Use 'diagnostic' for the opening pre-instruction knowledge check. Ordinary concept quizzes during teaching are routed automatically by lesson_note and normally do not require this tool.",
	}),
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
	return callout("question", "Question", body);
}

function buildQuizResultBlock(details: any): string {
	if (details?.status === "cancelled") {
		return callout("warning", "Result — skipped", ["(user skipped)"]);
	}

	if (details?.status === "unavailable") {
		return callout("warning", "Result — unavailable", [details?.message || ""]);
	}

	const dontKnow = details?.dontKnow === true;
	const correct = details?.correct === true;
	const type = dontKnow ? "question" : correct ? "success" : "failure";
	const title = dontKnow
		? "Result — I don't know"
		: correct
			? "Result — correct ✓"
			: "Result — incorrect ✗";
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
	let planFile: string | null = null;
	let planSlug: string | null = null;
	let lessonFile: string | null = null;
	let lessonSlug: string | null = null;
	let quizFile: string | null = null;
	let quizSlug: string | null = null;
	let quizPhase: QuizPhase | null = null;

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

	function persistState(): void {
		pi.appendEntry("lesson-log", {
			subjectDir,
			planFile,
			planSlug,
			lessonFile,
			lessonSlug,
			quizFile,
			quizSlug,
			quizPhase,
		});
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

	function planPath(slug: string): string | null {
		if (!subjectDir) return null;
		return path.join(subjectDir, "plan", `${slug}.md`);
	}

	function topicPath(slug: string): string | null {
		if (!subjectDir) return null;
		return path.join(subjectDir, "topic", `${slug}.md`);
	}

	function quizPath(slug: string, phase: QuizPhase): string | null {
		if (!subjectDir) return null;
		return path.join(subjectDir, "quiz", `${slug}-${phase}.md`);
	}

	function setQuizContext(topicInput: string, phase: QuizPhase): { file: string; slug: string } | null {
		if (!subjectDir) return null;
		const slug = slugify(topicInput);
		if (!slug) return null;
		const file = quizPath(slug, phase);
		if (!file) return null;

		quizSlug = slug;
		quizPhase = phase;
		quizFile = file;
		return { file, slug };
	}

	function writePlan(topicInput: string, titleInput: string | undefined, content: string): { file: string; slug: string } | null {
		if (!subjectDir) return null;
		const slug = slugify(topicInput);
		if (!slug) return null;
		const file = planPath(slug);
		if (!file) return null;

		const body = content.trim();
		if (!body) return null;

		fs.mkdirSync(path.dirname(file), { recursive: true });
		const title = titleInput?.trim() || titleFromSlug(slug);
		fs.writeFileSync(file, `# ${title} — Learning Plan\n\n${body}\n`, "utf-8");
		planSlug = slug;
		planFile = file;
		return { file, slug };
	}

	function ensureQuizFile(file: string, slug: string, phase: QuizPhase): void {
		if (fs.existsSync(file)) return;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const title = titleFromSlug(slug);
		const heading = phase === "diagnostic" ? `${title} — Diagnostic` : `${title} — Lesson Quiz`;
		const intro = phase === "diagnostic" ? "\nTaken before instruction.\n" : "";
		fs.writeFileSync(file, `# ${heading}\n${intro}`, "utf-8");
	}

	function nextQuizNumber(file: string): number {
		if (!fs.existsSync(file)) return 1;
		const current = fs.readFileSync(file, "utf-8");
		const matches = [...current.matchAll(/^## Quiz (\d+)\s*$/gm)];
		let max = 0;
		for (const match of matches) {
			const value = Number(match[1]);
			if (Number.isFinite(value) && value > max) max = value;
		}
		return max + 1;
	}

	function appendQuizUnit(
		file: string,
		slug: string,
		phase: QuizPhase,
		questionBlock: string,
		resultBlock: string,
	): void {
		ensureQuizFile(file, slug, phase);
		const number = nextQuizNumber(file);
		appendToFile(file, `## Quiz ${number}\n\n${questionBlock}\n\n${resultBlock}`);
	}

	function activateLesson(
		ctx: any,
		topicInput: string,
		titleInput?: string,
	): { file: string; slug: string; created: boolean; quizFile: string } | null {
		if (!subjectDir) return null;

		const slug = slugify(topicInput);
		if (!slug) return null;

		const file = topicPath(slug);
		if (!file) return null;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const created = !fs.existsSync(file);
		if (created) {
			const title = titleInput?.trim() || titleFromSlug(slug);
			fs.writeFileSync(file, `# ${title}\n`, "utf-8");
		}

		lessonSlug = slug;
		lessonFile = file;

		const quiz = setQuizContext(slug, "lesson");
		if (!quiz) return null;

		persistState();

		if (ctx?.ui) {
			const theme = ctx.ui.theme;
			ctx.ui.setStatus(
				"lesson-log",
				theme.fg("accent", "📘 ") + theme.fg("dim", path.basename(file)),
			);
		}

		return { file, slug, created, quizFile: quiz.file };
	}

	pi.on("session_start", async (_event, ctx: any) => {
		let last: LessonState | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "lesson-log") {
				last = entry.data as LessonState;
			}
		}

		if (!last?.subjectDir) return;
		subjectDir = last.subjectDir;
		fs.mkdirSync(path.join(subjectDir, "plan"), { recursive: true });
		fs.mkdirSync(path.join(subjectDir, "topic"), { recursive: true });
		fs.mkdirSync(path.join(subjectDir, "quiz"), { recursive: true });

		if (last.planSlug) {
			const slug = slugify(last.planSlug);
			const file = planPath(slug);
			if (file && fs.existsSync(file)) {
				planSlug = slug;
				planFile = file;
			}
		}

		if (last.lessonSlug) {
			const slug = slugify(last.lessonSlug);
			const file = topicPath(slug);
			if (file && fs.existsSync(file)) {
				lessonSlug = slug;
				lessonFile = file;
			}
		}

		if (last.quizSlug && last.quizPhase) {
			setQuizContext(last.quizSlug, last.quizPhase);
		} else if (lessonSlug) {
			setQuizContext(lessonSlug, "lesson");
		}

		if (lessonFile) {
			const theme = ctx.ui.theme;
			ctx.ui.setStatus(
				"lesson-log",
				theme.fg("accent", "📘 ") + theme.fg("dim", path.basename(lessonFile)),
			);
		}
	});

	pi.registerCommand("learn", {
		description: "Set the learning subject directory; creates plan/, topic/, and quiz/ beneath it",
		handler: async (args, ctx: any) => {
			const raw = args.trim();
			if (!raw) {
				ctx.ui.notify("Usage: /learn <directory>", "warning");
				return;
			}

			const resolved = path.isAbsolute(raw) ? raw : path.resolve(ctx.cwd, raw);
			fs.mkdirSync(path.join(resolved, "plan"), { recursive: true });
			fs.mkdirSync(path.join(resolved, "topic"), { recursive: true });
			fs.mkdirSync(path.join(resolved, "quiz"), { recursive: true });

			subjectDir = resolved;
			planFile = null;
			planSlug = null;
			lessonFile = null;
			lessonSlug = null;
			quizFile = null;
			quizSlug = null;
			quizPhase = null;
			pendingQuizzes.clear();
			persistState();

			ctx.ui.setStatus("lesson-log", undefined);
			ctx.ui.notify(
				`Learning directory: ${resolved}\nPlans: ${path.join(resolved, "plan")}\nTopics: ${path.join(resolved, "topic")}\nQuizzes: ${path.join(resolved, "quiz")}`,
				"success",
			);
		},
	});

	pi.registerCommand("lesson", {
		description: "Manually start or switch to a concept note",
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

			ctx.ui.notify(`Topic note: ${result.file}\nLesson quizzes: ${result.quizFile}`, "success");
		},
	});

	pi.registerCommand("lesson-stop", {
		description: "Stop writing topic notes and capturing quizzes",
		handler: async (_args, ctx: any) => {
			lessonFile = null;
			lessonSlug = null;
			quizFile = null;
			quizSlug = null;
			quizPhase = null;
			pendingQuizzes.clear();
			persistState();
			ctx.ui.setStatus("lesson-log", undefined);
			ctx.ui.notify("Lesson logging stopped", "info");
		},
	});

	pi.registerCommand("lesson-status", {
		description: "Show current learning directory, plan, concept note, and quiz target",
		handler: async (_args, ctx: any) => {
			ctx.ui.notify(
				`Learning directory: ${subjectDir ?? "(not set)"}\nPlan: ${planFile ?? "(not active)"}\nTopic note: ${lessonFile ?? "(not active)"}\nQuiz file: ${quizFile ?? "(not active)"}`,
				"info",
			);
		},
	});

	pi.registerTool({
		name: "lesson_quiz_context",
		label: "lesson quiz context",
		description:
			"Choose the quiz file before a quiz that happens without an active concept note. Use this BEFORE the opening pre-instruction knowledge check with phase='diagnostic' and the overall requested lesson/topic slug. During normal teaching, lesson_note automatically routes quizzes to quiz/<concept>-lesson.md, so this tool is usually unnecessary after instruction begins.",
		promptSnippet:
			"Before the opening diagnostic/probe quiz, call lesson_quiz_context({ topic: '<overall-lesson-slug>', phase: 'diagnostic' }). Once lesson_note is called for a concept, lesson quizzes are routed automatically.",
		promptGuidelines: [
			"Always call this before the first diagnostic quiz in a teach session so the learner's pre-instruction baseline is preserved.",
			"For the diagnostic topic, use the overall requested lesson or subject being assessed, not the first concept node.",
			"Use phase='diagnostic' for quizzes intended to gauge knowledge before teaching.",
			"Do not repeatedly call this for ordinary concept quizzes. lesson_note automatically switches the quiz target to <concept>-lesson.md.",
		],
		parameters: LessonQuizContextParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!subjectDir) {
				return {
					content: [{ type: "text", text: "No learning directory is configured. Ask the user to run /learn <subject-directory> first." }],
					details: { status: "no-subject" },
				};
			}

			const phase = params.phase as QuizPhase;
			const result = setQuizContext(params.topic, phase);
			if (!result) {
				return {
					content: [{ type: "text", text: "Invalid quiz topic. Use a short non-empty stable slug." }],
					details: { status: "invalid-topic" },
				};
			}

			persistState();
			return {
				content: [{ type: "text", text: `Quiz context set: ${result.file}` }],
				details: { status: "active", file: result.file, topic: result.slug, phase },
			};
		},
	});

	pi.registerTool({
		name: "lesson_plan",
		label: "lesson plan",
		description:
			"Create or replace the current overall learning plan under <subject>/plan/<topic>.md. Use the overall requested lesson slug, normally the same slug used for the opening diagnostic. The content must be the COMPLETE current plan body, not a patch or transcript. Call this after the diagnostic when the dependency map is formed, and update it as meaningful progress changes the current position or next step.",
		promptSnippet:
			"After the diagnostic/probe and dependency planning, call lesson_plan with the overall lesson slug and the complete current plan. Keep the plan current as concepts are completed or the learner changes direction.",
		promptGuidelines: [
			"Use the same overall slug as the diagnostic when they describe the same learning track.",
			"Include a concise goal, diagnostic-informed starting point, dependency map or sequence, progress checklist, current position, and next step.",
			"The content parameter is the COMPLETE latest plan body. lesson_plan replaces the previous file body instead of appending.",
			"When updating an existing plan, preserve still-valid information and change only what progress or new evidence requires.",
			"Update the plan after meaningful milestones such as finishing a concept, changing the learning sequence, or discovering a prerequisite gap. Do not rewrite it for every chat turn.",
			"Do not put full lesson explanations or quiz transcripts in the plan; link or name concepts instead.",
		],
		parameters: LessonPlanParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!subjectDir) {
				return {
					content: [{ type: "text", text: "No learning directory is configured. Ask the user to run /learn <subject-directory> first." }],
					details: { status: "no-subject" },
				};
			}

			const result = writePlan(params.topic, params.title, params.content);
			if (!result) {
				return {
					content: [{ type: "text", text: "Invalid lesson plan. Use a non-empty stable topic slug and non-empty complete plan content." }],
					details: { status: "invalid-plan" },
				};
			}

			persistState();
			return {
				content: [{ type: "text", text: `Saved current learning plan: ${result.file}` }],
				details: { status: "written", file: result.file, topic: result.slug },
			};
		},
	});

	pi.registerTool({
		name: "lesson_note",
		label: "lesson note",
		description:
			"Switch the active Obsidian topic note to the distinct concept you are about to teach. Topic notes live under <subject>/topic/. This also automatically routes subsequent quizzes to <subject>/quiz/<concept>-lesson.md.",
		promptSnippet:
			"Before teaching each distinct concept, call lesson_note. Then use lesson_write for durable prose. Any quiz after lesson_note is automatically stored separately in quiz/<concept>-lesson.md.",
		promptGuidelines: [
			"The user controls the subject directory with /learn <dir>. Never silently change it.",
			"Before teaching a distinct concept, call lesson_note with a short stable topic slug.",
			"Reuse the SAME topic slug when revisiting a concept.",
			"Do not switch notes for clarifications, examples, quizzes, retries, researcher calls, or stylistic changes if the underlying concept is unchanged.",
			"Choose concept-sized notes such as 'inheritance', 'context-window', or 'agent-harness'.",
		],
		parameters: LessonNoteParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!subjectDir) {
				return {
					content: [{ type: "text", text: "No learning directory is configured. Ask the user to run /learn <subject-directory> once, then retry lesson_note." }],
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
				content: [{ type: "text", text: `${result.created ? "Created" : "Activated"} topic note: ${result.file}. Lesson quizzes route to: ${result.quizFile}` }],
				details: {
					status: "active",
					file: result.file,
					topic: result.slug,
					created: result.created,
					quizFile: result.quizFile,
				},
			};
		},
	});

	pi.registerTool({
		name: "lesson_write",
		label: "lesson write",
		description:
			"Append intentionally curated, durable Markdown to the active concept note under <subject>/topic/. Never write quiz content here; quizzes are captured separately under <subject>/quiz/.",
		promptSnippet:
			"Use lesson_write to save only durable knowledge to the active topic note. If a quiz follows, finish lesson_write first; quiz capture goes to a separate file automatically.",
		promptGuidelines: [
			"Call lesson_write only when there is durable knowledge worth keeping.",
			"Write standalone Markdown that makes sense without the surrounding conversation.",
			"Prefer the distilled explanation over copying your chat response verbatim.",
			"Do not save conversational filler, subagent process commentary, tool-call details, or quiz content.",
			"If the current concept changes, call lesson_note first.",
		],
		parameters: LessonWriteParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!lessonFile) {
				return {
					content: [{ type: "text", text: "No active topic note. Call lesson_note for the current concept first." }],
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
				details: { status: "written", file: target, topic: lessonSlug },
			};
		},
	});

	// Capture the post-shuffle question but wait for the result before writing.
	// This keeps each question/result pair together and preserves chronology.
	pi.on("tool_execution_update", async (event, _ctx) => {
		if (!quizFile || !quizSlug || !quizPhase) return;
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
			file: quizFile,
			slug: quizSlug,
			phase: quizPhase,
			questionBlock: buildQuizQuestionBlock(question, context, options),
		});
	});

	pi.on("tool_result", async (event, _ctx) => {
		if ((event as any).toolName !== "quiz") return;

		const toolCallId = String((event as any).toolCallId || "");
		const details: any = (event as any).details || {};
		const pending = toolCallId ? pendingQuizzes.get(toolCallId) : undefined;

		const targetFile = pending?.file ?? quizFile;
		const targetSlug = pending?.slug ?? quizSlug;
		const targetPhase = pending?.phase ?? quizPhase;
		if (!targetFile || !targetSlug || !targetPhase) return;

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
		await withLock(() => appendQuizUnit(targetFile, targetSlug, targetPhase, questionBlock, resultBlock));

		if (toolCallId) pendingQuizzes.delete(toolCallId);
	});
}
