/**
 * lesson-log — clean human-facing notes + hidden adaptive learning state.
 *
 * Visible:
 *   <subject>/plan/<track>.md
 *   <subject>/topic/<concept>.md
 *   <subject>/quiz/<track>-diagnostic.md
 *   <subject>/quiz/<concept>-lesson.md
 *
 * Hidden machine state:
 *   <subject>/.learning/state.json
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

type QuizPhase = "diagnostic" | "lesson";
type LifecyclePhase = "idle" | "diagnostic" | "planning" | "teaching" | "assessment" | "finished";
type TopicStatus = "learning" | "blocked" | "complete";
type StepState = "done" | "current" | "next" | "upcoming" | "skipped";

type AssessmentStats = {
	correct: number;
	total: number;
	lastCorrect: boolean | null;
	codeCorrect: number;
	codeTotal: number;
	lastCodeCorrect: boolean | null;
};

type Misconception = {
	text: string;
	correction: string;
	evidence?: string;
	resolved: boolean;
};

type TopicState = {
	title: string;
	file: string;
	status: TopicStatus;
	requiresCode: boolean;
	prerequisites: string[];
	related: string[];
	assessments: AssessmentStats;
	misconceptions: Misconception[];
};

type PlanStep = {
	topic: string;
	title: string;
	description?: string;
	state: StepState;
};

type HiddenState = {
	version: 2;
	subject: string;
	track?: {
		slug: string;
		title: string;
		lifecycle: LifecyclePhase;
		planFile: string;
		diagnosticFile: string;
	};
	plan?: {
		steps: PlanStep[];
		currentPosition: string;
		next: string;
	};
	topics: Record<string, TopicState>;
};

type SessionState = {
	subjectDir?: string | null;
	subjectKey?: string | null;
	trackSlug?: string | null;
	trackTitle?: string | null;
	lifecycle?: LifecyclePhase | null;
	planFile?: string | null;
	lessonFile?: string | null;
	lessonSlug?: string | null;
	quizFile?: string | null;
	quizSlug?: string | null;
	quizPhase?: QuizPhase | null;
};

const LessonStartParams = Type.Object({
	topic: Type.String({ description: "Stable slug for the overall learning track." }),
	title: Type.Optional(Type.String({ description: "Optional readable title." })),
});

const LessonPlanParams = Type.Object({
	topic: Type.String({ description: "Stable overall learning-track slug." }),
	title: Type.Optional(Type.String({ description: "Optional readable plan title." })),
	summary: Type.Optional(Type.String({ description: "One-sentence deck under the plan title." })),
	goal: Type.String({ description: "Concise learning goal." }),
	startingPoint: Type.String({ description: "Diagnostic-informed starting point." }),
	dependencyMap: Type.String({ description: "Compact dependency map, preferably Mermaid Markdown." }),
	steps: Type.Array(
		Type.Object({
			topic: Type.String({ description: "Stable concept slug." }),
			title: Type.String({ description: "Readable concept title." }),
			description: Type.Optional(Type.String({ description: "One concise sentence about the node." })),
			state: Type.Union([
				Type.Literal("done"),
				Type.Literal("current"),
				Type.Literal("next"),
				Type.Literal("upcoming"),
				Type.Literal("skipped"),
			]),
		}),
		{ minItems: 1, description: "Adaptive learning path in dependency order." },
	),
	currentPosition: Type.String({ description: "Hidden lifecycle state for the current position." }),
	next: Type.String({ description: "Hidden lifecycle state for what comes next." }),
});

const LessonNoteParams = Type.Object({
	topic: Type.String({ description: "Stable concept slug." }),
	title: Type.Optional(Type.String({ description: "Readable concept title." })),
	summary: Type.Optional(Type.String({ description: "Optional one-sentence deck under the title." })),
	prerequisites: Type.Optional(Type.Array(Type.String())),
	related: Type.Optional(Type.Array(Type.String())),
	requiresCode: Type.Optional(
		Type.Boolean({ description: "True when full understanding of this concept requires successful implementation/debugging/querying code." }),
	),
});

const LessonWriteParams = Type.Object({
	heading: Type.String({
		description:
			"Readable section heading such as 'Core idea', 'Why it exists', 'Mental model', 'How it works', or any more appropriate heading. Empty template sections are never created.",
	}),
	content: Type.String({ description: "Complete clean standalone Markdown for the section, without repeating the heading." }),
	mode: Type.Optional(Type.Union([Type.Literal("replace"), Type.Literal("append")])),
});

const LessonMisconceptionParams = Type.Object({
	topic: Type.Optional(Type.String({ description: "Concept slug; omit to use the active concept." })),
	misconception: Type.String({ description: "The actual mistaken model, stated concisely." }),
	correction: Type.String({ description: "The replacement mental model." }),
	evidence: Type.Optional(Type.String()),
	resolved: Type.Optional(Type.Boolean()),
});

const LessonProgressParams = Type.Object({
	status: Type.Union([Type.Literal("learning"), Type.Literal("blocked"), Type.Literal("complete")]),
	reason: Type.Optional(Type.String()),
});

const LessonFinishParams = Type.Object({
	force: Type.Optional(Type.Boolean({ description: "Only true when the learner explicitly wants to stop before the path is complete." })),
});

function slugify(input: string): string {
	return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug: string): string {
	return slug.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function normalizeSlugs(values: string[] | undefined, exclude?: string): string[] {
	const set = new Set<string>();
	for (const value of values || []) {
		const slug = slugify(value);
		if (slug && slug !== exclude) set.add(slug);
	}
	return [...set];
}

function blankStats(): AssessmentStats {
	return { correct: 0, total: 0, lastCorrect: null, codeCorrect: 0, codeTotal: 0, lastCodeCorrect: null };
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertSection(body: string, heading: string, content: string, mode: "replace" | "append" = "replace"): string {
	const cleanHeading = heading.trim();
	const cleanContent = content.trim();
	if (!cleanHeading || !cleanContent) return body.trim();
	const regex = new RegExp(`^## ${escapeRegExp(cleanHeading)}\\s*$`, "mi");
	const match = regex.exec(body);
	if (!match) return `${body.trim()}\n\n## ${cleanHeading}\n\n${cleanContent}`.trim();

	const start = match.index + match[0].length;
	const rest = body.slice(start);
	const next = /^##\s+/m.exec(rest);
	const end = next ? start + next.index : body.length;
	const previous = body.slice(start, end).trim();
	const nextContent = mode === "append" && previous ? `${previous}\n\n${cleanContent}` : cleanContent;
	return `${body.slice(0, start).trimEnd()}\n\n${nextContent}${body.slice(end).trim() ? `\n\n${body.slice(end).trimStart()}` : ""}`.trim();
}

function renderStep(step: PlanStep, index: number): string {
	const suffix = step.state === "done"
		? " — learned"
		: step.state === "current"
			? " — current"
			: step.state === "next"
				? " — next"
				: step.state === "skipped"
					? " — already known"
					: "";
	const description = step.description?.trim() ? `\n   ${step.description.trim()}` : "";
	return `${index + 1}. **${step.title.trim()}**${suffix}${description}`;
}

function renderPlan(title: string, summary: string | undefined, goal: string, startingPoint: string, dependencyMap: string, steps: PlanStep[]): string {
	const parts = [`# ${title.trim() || "Learning Plan"}`];
	if (summary?.trim()) parts.push("", summary.trim());
	parts.push(
		"",
		"## Goal",
		"",
		goal.trim(),
		"",
		"## Starting point",
		"",
		startingPoint.trim(),
		"",
		"## Dependency map",
		"",
		dependencyMap.trim(),
		"",
		"## Path",
		"",
		steps.map(renderStep).join("\n\n"),
	);
	return `${parts.join("\n").trim()}\n`;
}

export default function lessonLog(pi: ExtensionAPI) {
	let subjectDir: string | null = null;
	let subjectKey: string | null = null;
	let trackSlug: string | null = null;
	let trackTitle: string | null = null;
	let lifecycle: LifecyclePhase = "idle";
	let planFile: string | null = null;
	let lessonFile: string | null = null;
	let lessonSlug: string | null = null;
	let quizFile: string | null = null;
	let quizSlug: string | null = null;
	let quizPhase: QuizPhase | null = null;

	let writeLock: Promise<void> = Promise.resolve();
	function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const previous = writeLock;
		let release!: () => void;
		writeLock = new Promise<void>((resolve) => { release = resolve; });
		return previous.then(fn).finally(() => release());
	}

	function hiddenDir(): string | null {
		return subjectDir ? path.join(subjectDir, ".learning") : null;
	}

	function hiddenStatePath(): string | null {
		const dir = hiddenDir();
		return dir ? path.join(dir, "state.json") : null;
	}

	function ensureDirs(): void {
		if (!subjectDir) return;
		for (const dir of ["plan", "topic", "quiz", ".learning", ".learning/assessments", ".learning/submissions", ".learning/results"]) {
			fs.mkdirSync(path.join(subjectDir, dir), { recursive: true });
		}
	}

	function readHiddenState(): HiddenState {
		if (!subjectDir || !subjectKey) throw new Error("No learning subject configured");
		ensureDirs();
		const file = hiddenStatePath()!;
		if (fs.existsSync(file)) {
			try {
				const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
				return { version: 2, subject: subjectKey, topics: {}, ...parsed, topics: parsed.topics || {} };
			} catch {
				// Fall through to a clean state rather than corrupting visible notes.
			}
		}
		return { version: 2, subject: subjectKey, topics: {} };
	}

	function writeHiddenState(state: HiddenState): void {
		const file = hiddenStatePath();
		if (!file) return;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temp = `${file}.tmp`;
		fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
		fs.renameSync(temp, file);
	}

	function persistSession(): void {
		pi.appendEntry("lesson-log", {
			subjectDir,
			subjectKey,
			trackSlug,
			trackTitle,
			lifecycle,
			planFile,
			lessonFile,
			lessonSlug,
			quizFile,
			quizSlug,
			quizPhase,
		} satisfies SessionState);
	}

	function topicPath(slug: string): string | null {
		return subjectDir ? path.join(subjectDir, "topic", `${slug}.md`) : null;
	}

	function planPath(slug: string): string | null {
		return subjectDir ? path.join(subjectDir, "plan", `${slug}.md`) : null;
	}

	function quizPath(slug: string, phase: QuizPhase): string | null {
		return subjectDir ? path.join(subjectDir, "quiz", `${slug}-${phase}.md`) : null;
	}

	function ensureQuizFile(slug: string, phase: QuizPhase): string | null {
		const file = quizPath(slug, phase);
		if (!file) return null;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		if (!fs.existsSync(file)) {
			const title = phase === "diagnostic" ? `${titleFromSlug(slug)} — Diagnostic` : `${titleFromSlug(slug)} — Quiz`;
			fs.writeFileSync(file, `# ${title}\n`, "utf-8");
		}
		return file;
	}

	function ensureTopic(slug: string, title: string, summary?: string): string | null {
		const file = topicPath(slug);
		if (!file) return null;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		if (!fs.existsSync(file)) {
			const parts = [`# ${title}`];
			if (summary?.trim()) parts.push("", summary.trim());
			fs.writeFileSync(file, `${parts.join("\n").trim()}\n`, "utf-8");
		} else if (summary?.trim()) {
			const current = fs.readFileSync(file, "utf-8");
			const lines = current.split("\n");
			const firstHeading = lines.findIndex((line, index) => index > 0 && /^##\s+/.test(line));
			const preludeEnd = firstHeading >= 0 ? firstHeading : lines.length;
			const prelude = lines.slice(0, preludeEnd).join("\n").trim();
			if (!prelude.includes(summary.trim())) {
				const body = firstHeading >= 0 ? lines.slice(firstHeading).join("\n").trimStart() : "";
				fs.writeFileSync(file, `${lines[0]}\n\n${summary.trim()}${body ? `\n\n${body}` : ""}\n`, "utf-8");
			}
		}
		return file;
	}

	function setQuizContext(slug: string, phase: QuizPhase): string | null {
		const file = ensureQuizFile(slug, phase);
		if (!file) return null;
		quizSlug = slug;
		quizPhase = phase;
		quizFile = file;
		return file;
	}

	function ensureTopicState(state: HiddenState, slug: string, title: string, file: string): TopicState {
		const existing = state.topics[slug];
		if (existing) return existing;
		const created: TopicState = {
			title,
			file,
			status: "learning",
			requiresCode: false,
			prerequisites: [],
			related: [],
			assessments: blankStats(),
			misconceptions: [],
		};
		state.topics[slug] = created;
		return created;
	}

	function evaluateVisibleNote(file: string): { ready: boolean; reasons: string[]; headings: number; words: number } {
		const text = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
		const headings = (text.match(/^##\s+.+$/gm) || []).length;
		const emptyHeading = /^##\s+.+\n\s*(?=##\s+|$)/m.test(text);
		const body = text.replace(/^#+\s+.*$/gm, " ").replace(/```[\s\S]*?```/g, " code ").trim();
		const words = body.split(/\s+/).filter(Boolean).length;
		const reasons: string[] = [];
		if (!/^#\s+\S+/m.test(text)) reasons.push("missing title");
		if (headings < 2) reasons.push("needs at least two useful sections");
		if (words < 120) reasons.push("lesson note is too thin");
		if (emptyHeading) reasons.push("contains an empty section");
		if (/^- \[[ xX]\]/m.test(text)) reasons.push("contains task-list UI that belongs in the assessment plugin");
		return { ready: reasons.length === 0, reasons, headings, words };
	}

	pi.on("session_start", async (_event, ctx: any) => {
		let last: SessionState | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "lesson-log") last = entry.data as SessionState;
		}
		if (!last?.subjectDir) return;
		subjectDir = last.subjectDir;
		subjectKey = last.subjectKey || path.basename(subjectDir);
		trackSlug = last.trackSlug || null;
		trackTitle = last.trackTitle || null;
		lifecycle = last.lifecycle || "idle";
		planFile = last.planFile || null;
		lessonFile = last.lessonFile || null;
		lessonSlug = last.lessonSlug || null;
		quizFile = last.quizFile || null;
		quizSlug = last.quizSlug || null;
		quizPhase = last.quizPhase || null;
		ensureDirs();
	});

	pi.registerCommand("learn", {
		description: "Set the learning subject directory",
		handler: async (args, ctx: any) => {
			const raw = args.trim();
			if (!raw) {
				ctx.ui.notify("Usage: /learn <directory>", "warning");
				return;
			}
			subjectDir = path.isAbsolute(raw) ? raw : path.resolve(ctx.cwd, raw);
			subjectKey = path.isAbsolute(raw) ? path.basename(subjectDir) : raw.replace(/\\/g, "/").replace(/^\.\//, "");
			trackSlug = null;
			trackTitle = null;
			lifecycle = "idle";
			planFile = null;
			lessonFile = null;
			lessonSlug = null;
			quizFile = null;
			quizSlug = null;
			quizPhase = null;
			ensureDirs();
			const state = readHiddenState();
			writeHiddenState(state);
			persistSession();
			ctx.ui.notify(`Learning directory: ${subjectDir}\nVisible: plan/ topic/ quiz/\nHidden state: ${hiddenDir()}`, "success");
		},
	});

	pi.registerCommand("lesson-status", {
		description: "Show current learning state",
		handler: async (_args, ctx: any) => {
			ctx.ui.notify(
				`Subject: ${subjectDir ?? "(not set)"}\nTrack: ${trackSlug ?? "(not started)"}\nLifecycle: ${lifecycle}\nPlan: ${planFile ?? "(none)"}\nTopic: ${lessonFile ?? "(none)"}\nAssessment: ${quizFile ?? "(none)"}`,
				"info",
			);
		},
	});

	pi.registerTool({
		name: "lesson_start",
		label: "lesson start",
		description: "Start a learning track and route the opening diagnostic to Obsidian. Does not create a prefilled visible plan.",
		promptSnippet: "Call once before the first diagnostic assessment.",
		parameters: LessonStartParams,
		async execute(_id, params) {
			if (!subjectDir) return { content: [{ type: "text", text: "Run /learn <subject> first." }], details: { status: "no-subject" } };
			const slug = slugify(params.topic);
			if (!slug) return { content: [{ type: "text", text: "Invalid track topic." }], details: { status: "invalid-topic" } };
			trackSlug = slug;
			trackTitle = params.title?.trim() || titleFromSlug(slug);
			planFile = planPath(slug);
			lessonFile = null;
			lessonSlug = null;
			const diagnostic = setQuizContext(slug, "diagnostic");
			if (!diagnostic || !planFile) return { content: [{ type: "text", text: "Could not initialize track." }], details: { status: "error" } };
			lifecycle = "diagnostic";
			const state = readHiddenState();
			state.track = { slug, title: trackTitle, lifecycle, planFile, diagnosticFile: diagnostic };
			writeHiddenState(state);
			persistSession();
			return { content: [{ type: "text", text: `Started ${trackTitle}. Diagnostic assessment file: ${diagnostic}` }], details: { status: "diagnostic", topic: slug, quizFile: diagnostic } };
		},
	});

	pi.registerTool({
		name: "lesson_plan",
		label: "lesson plan",
		description: "Write a compact clean learning roadmap. Adaptive status stays hidden; the visible plan only shows useful learning information.",
		promptSnippet: "After the diagnostic, write the clean plan and present it for learner approval before teaching.",
		parameters: LessonPlanParams,
		async execute(_id, params) {
			if (!subjectDir) return { content: [{ type: "text", text: "Run /learn first." }], details: { status: "no-subject" } };
			const slug = slugify(params.topic);
			const file = planPath(slug);
			if (!slug || !file) return { content: [{ type: "text", text: "Invalid plan topic." }], details: { status: "invalid-topic" } };
			const title = params.title?.trim() || trackTitle || titleFromSlug(slug);
			const steps: PlanStep[] = params.steps.map((step: any) => ({
				topic: slugify(step.topic),
				title: String(step.title).trim(),
				description: step.description ? String(step.description).trim() : undefined,
				state: step.state as StepState,
			})).filter((step: PlanStep) => step.topic && step.title);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, renderPlan(title, params.summary, params.goal, params.startingPoint, params.dependencyMap, steps), "utf-8");
			planFile = file;
			trackSlug = trackSlug || slug;
			trackTitle = trackTitle || title;
			lifecycle = "planning";
			const state = readHiddenState();
			state.plan = { steps, currentPosition: params.currentPosition.trim(), next: params.next.trim() };
			if (state.track) state.track.lifecycle = lifecycle;
			writeHiddenState(state);
			persistSession();
			return { content: [{ type: "text", text: `Updated clean learning plan: ${file}` }], details: { status: "written", file } };
		},
	});

	pi.registerTool({
		name: "lesson_note",
		label: "lesson note",
		description: "Activate/create a clean concept note. No visible metadata or empty template sections are added.",
		promptSnippet: "Call before teaching a new concept. Then write the actual lesson into useful headings with lesson_write before assessing it.",
		parameters: LessonNoteParams,
		async execute(_id, params) {
			if (!subjectDir) return { content: [{ type: "text", text: "Run /learn first." }], details: { status: "no-subject" } };
			const slug = slugify(params.topic);
			const title = params.title?.trim() || titleFromSlug(slug);
			const file = ensureTopic(slug, title, params.summary);
			if (!slug || !file) return { content: [{ type: "text", text: "Invalid concept topic." }], details: { status: "invalid-topic" } };
			lessonSlug = slug;
			lessonFile = file;
			const assessmentFile = setQuizContext(slug, "lesson");
			lifecycle = "teaching";
			const state = readHiddenState();
			const topic = ensureTopicState(state, slug, title, file);
			topic.title = title;
			topic.file = file;
			topic.prerequisites = params.prerequisites === undefined ? topic.prerequisites : normalizeSlugs(params.prerequisites, slug);
			topic.related = params.related === undefined ? topic.related : normalizeSlugs(params.related, slug);
			topic.requiresCode = params.requiresCode === undefined ? topic.requiresCode : params.requiresCode === true;
			topic.status = topic.status === "complete" ? "complete" : "learning";
			if (state.track) state.track.lifecycle = lifecycle;
			writeHiddenState(state);
			persistSession();
			return { content: [{ type: "text", text: `Active lesson note: ${file}. Write the substantive node here before assessment.` }], details: { status: "active", file, topic: slug, quizFile: assessmentFile } };
		},
	});

	pi.registerTool({
		name: "lesson_write",
		label: "lesson write",
		description: "Create or update one useful section in the active visible lesson note. Headings are created only when content exists.",
		promptSnippet: "Write the lesson to Obsidian before assessment. Use clear natural headings; replace outdated sections rather than appending corrections beneath them.",
		parameters: LessonWriteParams,
		async execute(_id, params) {
			if (!lessonFile) return { content: [{ type: "text", text: "Call lesson_note first." }], details: { status: "no-lesson" } };
			const heading = params.heading.trim();
			const content = params.content.trim();
			if (!heading || !content) return { content: [{ type: "text", text: "Heading and content are required." }], details: { status: "empty" } };
			const mode = (params.mode || "replace") as "replace" | "append";
			await withLock(() => {
				const current = fs.readFileSync(lessonFile!, "utf-8");
				fs.writeFileSync(lessonFile!, `${upsertSection(current, heading, content, mode)}\n`, "utf-8");
			});
			return { content: [{ type: "text", text: `${mode === "replace" ? "Updated" : "Extended"} “${heading}” in ${lessonFile}` }], details: { status: "written", file: lessonFile, heading, mode } };
		},
	});

	pi.registerTool({
		name: "lesson_misconception",
		label: "lesson misconception",
		description: "Record/resolve a genuine misconception in hidden adaptive state without cluttering the visible note.",
		parameters: LessonMisconceptionParams,
		async execute(_id, params) {
			if (!subjectDir) return { content: [{ type: "text", text: "Run /learn first." }], details: { status: "no-subject" } };
			const slug = slugify(params.topic || lessonSlug || "");
			if (!slug) return { content: [{ type: "text", text: "No concept target." }], details: { status: "no-topic" } };
			const file = topicPath(slug)!;
			const state = readHiddenState();
			const topic = ensureTopicState(state, slug, titleFromSlug(slug), file);
			const marker = params.misconception.trim();
			const existing = topic.misconceptions.find((item) => item.text === marker);
			const item: Misconception = {
				text: marker,
				correction: params.correction.trim(),
				evidence: params.evidence?.trim() || undefined,
				resolved: params.resolved === true,
			};
			if (existing) Object.assign(existing, item);
			else topic.misconceptions.push(item);
			if (!item.resolved) topic.status = "learning";
			writeHiddenState(state);
			return { content: [{ type: "text", text: `${item.resolved ? "Resolved" : "Recorded"} misconception for ${slug} in hidden learning state.` }], details: { status: item.resolved ? "resolved" : "recorded", topic: slug } };
		},
	});

	pi.registerTool({
		name: "lesson_quality",
		label: "lesson quality",
		description: "Audit the active lesson note for readable substance and mastery evidence without requiring a rigid visible template.",
		parameters: Type.Object({}),
		async execute() {
			if (!lessonFile || !lessonSlug) return { content: [{ type: "text", text: "No active lesson." }], details: { status: "no-lesson" } };
			const visible = evaluateVisibleNote(lessonFile);
			const state = readHiddenState();
			const topic = state.topics[lessonSlug];
			const unresolved = topic?.misconceptions.filter((item) => !item.resolved).length || 0;
			const stats = topic?.assessments || blankStats();
			const reasons = [...visible.reasons];
			if (unresolved > 0) reasons.push(`${unresolved} unresolved misconception(s)`);
			if (stats.total < 1) reasons.push("no successful/failed assessment evidence yet");
			if (stats.total >= 1 && stats.lastCorrect !== true) reasons.push("latest assessment is not correct");
			if (topic?.requiresCode && stats.codeTotal < 1) reasons.push("concept requires a coding exercise");
			if (topic?.requiresCode && stats.codeTotal >= 1 && stats.lastCodeCorrect !== true) reasons.push("latest coding exercise is not correct");
			const ready = reasons.length === 0;
			return {
				content: [{ type: "text", text: `Lesson quality: ${ready ? "ready" : "needs work"}. ${ready ? `Readable note with ${visible.headings} sections and ${visible.words} words; mastery evidence is clean.` : reasons.join("; ")}` }],
				details: { status: "reviewed", ready, reasons, headings: visible.headings, words: visible.words, unresolved, assessments: stats },
			};
		},
	});

	pi.registerTool({
		name: "lesson_progress",
		label: "lesson progress",
		description: "Set active concept status. Completion is gated by the clean note, assessment evidence, misconceptions, and coding evidence when required.",
		parameters: LessonProgressParams,
		async execute(_id, params) {
			if (!lessonFile || !lessonSlug) return { content: [{ type: "text", text: "No active lesson." }], details: { status: "no-lesson" } };
			const state = readHiddenState();
			const topic = ensureTopicState(state, lessonSlug, titleFromSlug(lessonSlug), lessonFile);
			if (params.status === "complete") {
				const visible = evaluateVisibleNote(lessonFile);
				const unresolved = topic.misconceptions.filter((item) => !item.resolved).length;
				const blockers = [...visible.reasons];
				if (unresolved) blockers.push(`${unresolved} unresolved misconception(s)`);
				if (topic.assessments.total < 1) blockers.push("no assessment evidence");
				else if (topic.assessments.lastCorrect !== true) blockers.push("latest assessment not correct");
				if (topic.requiresCode && topic.assessments.codeTotal < 1) blockers.push("coding exercise required");
				else if (topic.requiresCode && topic.assessments.lastCodeCorrect !== true) blockers.push("latest coding exercise not correct");
				if (blockers.length) {
					topic.status = "learning";
					writeHiddenState(state);
					return { content: [{ type: "text", text: `Cannot complete ${lessonSlug}: ${blockers.join("; ")}.` }], details: { status: "completion-blocked", blockers } };
				}
			}
			topic.status = params.status as TopicStatus;
			writeHiddenState(state);
			return { content: [{ type: "text", text: `Concept ${lessonSlug} is now ${params.status}${params.reason ? ` — ${params.reason}` : ""}. Update the clean plan if the path changed.` }], details: { status: params.status, topic: lessonSlug } };
		},
	});

	pi.registerTool({
		name: "lesson_finish",
		label: "lesson finish",
		description: "Finish the overall track after its hidden path has no unfinished nodes.",
		parameters: LessonFinishParams,
		async execute(_id, params) {
			if (!subjectDir) return { content: [{ type: "text", text: "No active track." }], details: { status: "no-track" } };
			const state = readHiddenState();
			const unfinished = (state.plan?.steps || []).filter((step) => !["done", "skipped"].includes(step.state));
			if (unfinished.length && params.force !== true) {
				return { content: [{ type: "text", text: `Cannot finish yet: ${unfinished.length} path node(s) remain.` }], details: { status: "finish-blocked", unfinished: unfinished.map((step) => step.topic) } };
			}
			lifecycle = "finished";
			if (state.track) state.track.lifecycle = lifecycle;
			writeHiddenState(state);
			persistSession();
			return { content: [{ type: "text", text: `Finished learning track ${trackTitle || trackSlug || ""}.` }], details: { status: "finished" } };
		},
	});
}
