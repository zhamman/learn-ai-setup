/**
 * lesson-log — structured learning plans, topic notes, and quiz history for Obsidian.
 *
 * Subject layout:
 *   <subject>/plan/<lesson>.md
 *   <subject>/topic/<concept>.md
 *   <subject>/quiz/<lesson>-diagnostic.md
 *   <subject>/quiz/<concept>-lesson.md
 *
 * Improvements implemented here:
 *   - standardized frontmatter + headings
 *   - explicit lesson lifecycle
 *   - misconception tracking
 *   - quiz-driven mastery gating
 *   - concept prerequisites + backlinks
 *   - mechanical note-quality evaluation
 *   - section-aware topic updates
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

type QuizPhase = "diagnostic" | "lesson";
type LifecyclePhase = "idle" | "diagnostic" | "planning" | "teaching" | "quiz" | "finished";
type TopicStatus = "learning" | "blocked" | "complete";
type MetaValue = string | number | boolean | string[];

type PendingQuiz = {
	file: string;
	slug: string;
	phase: QuizPhase;
	questionBlock: string;
	returnPhase: LifecyclePhase;
};

type LessonState = {
	subjectDir?: string | null;
	subjectKey?: string | null;
	sessionSlug?: string | null;
	sessionTitle?: string | null;
	lifecyclePhase?: LifecyclePhase | null;
	planFile?: string | null;
	planSlug?: string | null;
	lessonFile?: string | null;
	lessonSlug?: string | null;
	quizFile?: string | null;
	quizSlug?: string | null;
	quizPhase?: QuizPhase | null;
};

const TOPIC_SECTION_MAP = {
	"core-idea": "Core Idea",
	"why-it-exists": "Why It Exists",
	"mental-model": "Mental Model",
	"how-it-works": "How It Works",
	example: "Example",
	"common-mistakes": "Common Mistakes",
	notes: "Notes",
} as const;

type TopicSectionKey = keyof typeof TOPIC_SECTION_MAP;

const TOPIC_REQUIRED_SECTIONS = [
	"Core Idea",
	"Why It Exists",
	"Mental Model",
	"How It Works",
	"Example",
	"Common Mistakes",
] as const;

const TOPIC_ALL_SECTIONS = [
	...TOPIC_REQUIRED_SECTIONS,
	"Misconceptions",
	"Related Concepts",
	"Notes",
] as const;

const PLAN_SECTIONS = [
	"Goal",
	"Starting Point",
	"Dependency Map",
	"Learning Sequence",
	"Progress",
	"Current Position",
	"Next",
] as const;

const META_ORDER = [
	"type",
	"subject",
	"topic",
	"phase",
	"status",
	"confidence",
	"updated",
	"prerequisites",
	"related",
	"quiz_correct",
	"quiz_total",
	"quiz_score",
	"last_quiz_correct",
] as const;

const LessonStartParams = Type.Object({
	topic: Type.String({
		description:
			"Stable slug for the overall learning track, e.g. 'agent-orchestration', 'context-engineering', or 'python-oop'.",
	}),
	title: Type.Optional(
		Type.String({
			description: "Optional human-readable overall lesson title. Defaults to title-casing the topic slug.",
		}),
	),
});

const LessonPlanParams = Type.Object({
	topic: Type.String({
		description:
			"Stable overall learning-track slug. Reuse the same slug as lesson_start and the diagnostic quiz.",
	}),
	title: Type.Optional(Type.String({ description: "Optional human-readable plan title." })),
	goal: Type.String({ description: "Concise learning goal." }),
	startingPoint: Type.String({
		description:
			"Diagnostic-informed baseline: what the learner already knows, where the edge is, and any prerequisite gaps.",
	}),
	dependencyMap: Type.String({
		description:
			"Standalone Markdown for the dependency DAG, preferably a Mermaid code block with short stable concept labels.",
	}),
	learningSequence: Type.String({
		description:
			"Markdown checklist for the current adaptive sequence. Mark already-mastered/skipped nodes checked with a brief reason.",
	}),
	progress: Type.String({
		description: "Concise current progress summary based on diagnostic and lesson quiz evidence.",
	}),
	currentPosition: Type.String({ description: "Current concept/node or planning checkpoint." }),
	next: Type.String({ description: "Next concept, remediation step, or completion state." }),
});

const LessonNoteParams = Type.Object({
	topic: Type.String({
		description:
			"Stable short concept slug, e.g. 'agent-loop', 'context-window', or 'supervisor-pattern'. Reuse it when revisiting the concept.",
	}),
	title: Type.Optional(Type.String({ description: "Optional human-readable concept title." })),
	prerequisites: Type.Optional(
		Type.Array(Type.String(), {
			description: "Stable topic slugs this concept depends on. Used for frontmatter and explicit Obsidian links.",
		}),
	),
	related: Type.Optional(
		Type.Array(Type.String(), {
			description: "Stable topic slugs closely related to this concept but not strict prerequisites.",
		}),
	),
});

const LessonWriteParams = Type.Object({
	section: Type.Union(
		[
			Type.Literal("core-idea"),
			Type.Literal("why-it-exists"),
			Type.Literal("mental-model"),
			Type.Literal("how-it-works"),
			Type.Literal("example"),
			Type.Literal("common-mistakes"),
			Type.Literal("notes"),
		],
		{
			description:
				"Stable section to update. Use the narrowest semantic section instead of appending free-form prose to the end of the file.",
		},
	),
	content: Type.String({
		description:
			"Clean standalone Markdown for this section. No chat filler, quiz content, tool chatter, or duplicate headings.",
	}),
	mode: Type.Optional(
		Type.Union([Type.Literal("replace"), Type.Literal("append")], {
			description:
				"Default 'replace' keeps sections current and deduplicated. Use 'append' only for genuinely additive examples/notes.",
		}),
	),
});

const LessonMisconceptionParams = Type.Object({
	topic: Type.Optional(
		Type.String({
			description:
				"Optional stable concept slug to target. Use this during the opening diagnostic when no concept note is active yet.",
		}),
	),
	misconception: Type.String({
		description:
			"The learner's actual mistaken model or gap, stated concisely. Do not invent one from a careless miss without evidence.",
	}),
	correction: Type.String({ description: "The clean corrected model or fact that replaces the misconception." }),
	evidence: Type.Optional(
		Type.String({ description: "Optional concise evidence such as the quiz choice or learner statement that exposed the misconception." }),
	),
	resolved: Type.Optional(
		Type.Boolean({ description: "Set true once follow-up explanation/quiz shows the misconception has been corrected." }),
	),
});

const LessonProgressParams = Type.Object({
	status: Type.Union([Type.Literal("learning"), Type.Literal("blocked"), Type.Literal("complete")]),
	reason: Type.Optional(
		Type.String({ description: "Concise reason for the status, especially for blocked/remediation states." }),
	),
});

const LessonQuizContextParams = Type.Object({
	topic: Type.String({ description: "Stable slug for the thing being assessed." }),
	phase: Type.Union([Type.Literal("diagnostic"), Type.Literal("lesson")]),
});

const LessonFinishParams = Type.Object({
	summary: Type.Optional(
		Type.String({ description: "Optional concise completion summary for the plan's Progress section." }),
	),
	force: Type.Optional(
		Type.Boolean({
			description:
				"Normally false. Set true only when the learner explicitly wants to end with unchecked plan items remaining.",
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

function todayLocal(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function normalizeSlugList(values: string[] | undefined, exclude?: string): string[] {
	const out = new Set<string>();
	for (const value of values || []) {
		const slug = slugify(value);
		if (slug && slug !== exclude) out.add(slug);
	}
	return [...out];
}

function yamlScalar(value: string | number | boolean): string {
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

function parseScalar(raw: string): string | number | boolean {
	const value = raw.trim();
	if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
	if (value === "true") return true;
	if (value === "false") return false;
	if (value.startsWith('"') && value.endsWith('"')) {
		try {
			return JSON.parse(value);
		} catch {
			return value.slice(1, -1);
		}
	}
	return value;
}

function splitFrontmatter(text: string): { meta: Record<string, MetaValue>; body: string } {
	if (!text.startsWith("---\n")) return { meta: {}, body: text };
	const end = text.indexOf("\n---\n", 4);
	if (end < 0) return { meta: {}, body: text };

	const block = text.slice(4, end);
	const body = text.slice(end + 5);
	const meta: Record<string, MetaValue> = {};
	let listKey: string | null = null;

	for (const line of block.split("\n")) {
		const item = line.match(/^\s{2}-\s+(.*)$/);
		if (item && listKey) {
			const arr = Array.isArray(meta[listKey]) ? (meta[listKey] as string[]) : [];
			arr.push(String(parseScalar(item[1])));
			meta[listKey] = arr;
			continue;
		}

		const kv = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
		if (!kv) continue;
		const key = kv[1];
		const raw = kv[2] ?? "";
		if (raw.trim() === "" || raw.trim() === "[]") {
			meta[key] = [];
			listKey = raw.trim() === "" ? key : null;
		} else {
			meta[key] = parseScalar(raw);
			listKey = null;
		}
	}

	return { meta, body };
}

function renderFrontmatter(meta: Record<string, MetaValue>): string {
	const orderedKeys = [
		...META_ORDER.filter((key) => Object.prototype.hasOwnProperty.call(meta, key)),
		...Object.keys(meta).filter((key) => !META_ORDER.includes(key as any)).sort(),
	];
	const lines = ["---"];
	for (const key of orderedKeys) {
		const value = meta[key];
		if (Array.isArray(value)) {
			if (value.length === 0) lines.push(`${key}: []`);
			else {
				lines.push(`${key}:`);
				for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
			}
		} else {
			lines.push(`${key}: ${yamlScalar(value)}`);
		}
	}
	lines.push("---");
	return lines.join("\n");
}

function readFileParts(file: string): { meta: Record<string, MetaValue>; body: string } {
	if (!fs.existsSync(file)) return { meta: {}, body: "" };
	return splitFrontmatter(fs.readFileSync(file, "utf-8"));
}

function writeFileParts(file: string, meta: Record<string, MetaValue>, body: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const cleanBody = body.trim();
	fs.writeFileSync(file, `${renderFrontmatter(meta)}\n\n${cleanBody}\n`, "utf-8");
}

function updateMetadata(file: string, patch: Record<string, MetaValue>): void {
	const { meta, body } = readFileParts(file);
	const next = { ...meta, ...patch, updated: todayLocal() };
	writeFileParts(file, next, body);
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSection(body: string, heading: string): string {
	const headingRegex = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "m");
	const match = headingRegex.exec(body);
	if (!match) return "";
	const start = match.index + match[0].length;
	const rest = body.slice(start);
	const nextHeading = /^##\s+/m.exec(rest);
	const end = nextHeading ? start + nextHeading.index : body.length;
	return body.slice(start, end).trim();
}

function upsertSection(body: string, heading: string, content: string, mode: "replace" | "append" = "replace"): string {
	const clean = content.trim();
	const headingRegex = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "m");
	const match = headingRegex.exec(body);

	if (!match) {
		const prefix = body.trim().length > 0 ? `${body.trim()}\n\n` : "";
		return `${prefix}## ${heading}\n\n${clean}`.trim();
	}

	const contentStart = match.index + match[0].length;
	const rest = body.slice(contentStart);
	const nextHeading = /^##\s+/m.exec(rest);
	const contentEnd = nextHeading ? contentStart + nextHeading.index : body.length;
	const previous = body.slice(contentStart, contentEnd).trim();
	const nextContent = mode === "append" && previous && clean ? `${previous}\n\n${clean}` : clean || previous;
	const before = body.slice(0, contentStart).trimEnd();
	const after = body.slice(contentEnd).trimStart();
	return `${before}\n\n${nextContent}${after ? `\n\n${after}` : ""}`.trim();
}

function countUncheckedItems(markdown: string): number {
	return (markdown.match(/^- \[ \] /gm) || []).length;
}

function callout(type: string, title: string, bodyLines: string[]): string {
	const lines = [`> [!${type}] ${title}`];
	for (const line of bodyLines) lines.push(line.length === 0 ? ">" : `> ${line}`);
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
	if (details?.status === "cancelled") return callout("warning", "Result — skipped", ["(user skipped)"]);
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
	if (correctIndices.length > 0) body.push(`Correct answer: ${correctIndices.join(", ")}`);
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

function confidenceFromQuiz(correct: number, total: number): number {
	if (total >= 5 && correct / total >= 0.9) return 5;
	if (total >= 3 && correct / total >= 0.8) return 4;
	if (total >= 2 && correct / total >= 0.6) return 3;
	if (correct >= 1) return 2;
	return 1;
}

export default function lessonLog(pi: ExtensionAPI) {
	let subjectDir: string | null = null;
	let subjectKey: string | null = null;
	let sessionSlug: string | null = null;
	let sessionTitle: string | null = null;
	let lifecyclePhase: LifecyclePhase = "idle";
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
		writeLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		return prev.then(fn).finally(() => release());
	}

	function persistState(): void {
		pi.appendEntry("lesson-log", {
			subjectDir,
			subjectKey,
			sessionSlug,
			sessionTitle,
			lifecyclePhase,
			planFile,
			planSlug,
			lessonFile,
			lessonSlug,
			quizFile,
			quizSlug,
			quizPhase,
		});
	}

	function planPath(slug: string): string | null {
		return subjectDir ? path.join(subjectDir, "plan", `${slug}.md`) : null;
	}

	function topicPath(slug: string): string | null {
		return subjectDir ? path.join(subjectDir, "topic", `${slug}.md`) : null;
	}

	function quizPath(slug: string, phase: QuizPhase): string | null {
		return subjectDir ? path.join(subjectDir, "quiz", `${slug}-${phase}.md`) : null;
	}

	function ensureDirectories(): void {
		if (!subjectDir) return;
		fs.mkdirSync(path.join(subjectDir, "plan"), { recursive: true });
		fs.mkdirSync(path.join(subjectDir, "topic"), { recursive: true });
		fs.mkdirSync(path.join(subjectDir, "quiz"), { recursive: true });
	}

	function ensurePlanFile(slug: string, titleInput?: string): string | null {
		const file = planPath(slug);
		if (!file || !subjectKey) return null;
		const title = titleInput?.trim() || titleFromSlug(slug);
		if (!fs.existsSync(file)) {
			const body = [`# ${title} — Learning Plan`, ...PLAN_SECTIONS.flatMap((section) => ["", `## ${section}`, ""])].join("\n").trim();
			writeFileParts(file, {
				type: "plan",
				subject: subjectKey,
				topic: slug,
				status: "active",
				updated: todayLocal(),
			}, body);
		} else {
			const parts = readFileParts(file);
			let body = parts.body.trim();
			if (!/^#\s+.+$/m.test(body)) body = `# ${title} — Learning Plan\n\n${body}`.trim();
			for (const section of PLAN_SECTIONS) {
				if (!new RegExp(`^## ${escapeRegExp(section)}\\s*$`, "m").test(body)) {
					body = `${body}\n\n## ${section}`.trim();
				}
			}
			writeFileParts(file, {
				...parts.meta,
				type: "plan",
				subject: subjectKey,
				topic: slug,
				status: (parts.meta.status as string) || "active",
				updated: todayLocal(),
			}, body);
		}
		return file;
	}

	function ensureTopicFile(
		slug: string,
		titleInput?: string,
		prerequisites?: string[],
		related?: string[],
	): { file: string; created: boolean } | null {
		const file = topicPath(slug);
		if (!file || !subjectKey) return null;
		const created = !fs.existsSync(file);
		if (created) {
			const title = titleInput?.trim() || titleFromSlug(slug);
			const initialPrerequisites = prerequisites || [];
			const initialRelated = related || [];
			const bodyParts = [`# ${title}`];
			for (const section of TOPIC_ALL_SECTIONS) {
				bodyParts.push("", `## ${section}`, "");
				if (section === "Misconceptions") bodyParts.push("_None identified._");
			}
			writeFileParts(file, {
				type: "topic",
				subject: subjectKey,
				topic: slug,
				status: "learning",
				confidence: 1,
				updated: todayLocal(),
				prerequisites: initialPrerequisites,
				related: initialRelated,
				quiz_correct: 0,
				quiz_total: 0,
				quiz_score: 0,
				last_quiz_correct: false,
			}, bodyParts.join("\n").trim());
		} else {
			const parts = readFileParts(file);
			let body = parts.body.trim();
			const existingTitle = /^#\s+.+$/m.exec(body)?.[0] || `# ${titleInput?.trim() || titleFromSlug(slug)}`;
			if (!/^#\s+.+$/m.test(body)) body = `${existingTitle}\n\n${body}`.trim();
			for (const section of TOPIC_ALL_SECTIONS) {
				if (!new RegExp(`^## ${escapeRegExp(section)}\\s*$`, "m").test(body)) {
					body = `${body}\n\n## ${section}\n${section === "Misconceptions" ? "\n_None identified._" : ""}`.trim();
				}
			}
			const existingPrerequisites = Array.isArray(parts.meta.prerequisites) ? (parts.meta.prerequisites as string[]) : [];
			const existingRelated = Array.isArray(parts.meta.related) ? (parts.meta.related as string[]) : [];
			writeFileParts(file, {
				...parts.meta,
				type: "topic",
				subject: subjectKey,
				topic: slug,
				status: (parts.meta.status as string) || "learning",
				confidence: Number(parts.meta.confidence || 1),
				updated: todayLocal(),
				prerequisites: prerequisites === undefined ? existingPrerequisites : prerequisites,
				related: related === undefined ? existingRelated : related,
				quiz_correct: Number(parts.meta.quiz_correct || 0),
				quiz_total: Number(parts.meta.quiz_total || 0),
				quiz_score: Number(parts.meta.quiz_score || 0),
				last_quiz_correct: parts.meta.last_quiz_correct === true,
			}, body);
		}
		return { file, created };
	}

	function ensureQuizFile(file: string, slug: string, phase: QuizPhase): void {
		if (!subjectKey) return;
		const title = titleFromSlug(slug);
		const heading = phase === "diagnostic" ? `${title} — Diagnostic` : `${title} — Lesson Quiz`;
		const intro = phase === "diagnostic" ? "Taken before instruction." : "Captured during instruction.";
		if (!fs.existsSync(file)) {
			writeFileParts(file, {
				type: "quiz",
				subject: subjectKey,
				topic: slug,
				phase,
				status: "active",
				updated: todayLocal(),
				quiz_correct: 0,
				quiz_total: 0,
				quiz_score: 0,
			}, `# ${heading}\n\n${intro}`);
			return;
		}

		const parts = readFileParts(file);
		let body = parts.body.trim();
		if (!/^#\s+.+$/m.test(body)) body = `# ${heading}\n\n${intro}\n\n${body}`.trim();
		const detectedTotal = (body.match(/^## Quiz \d+\s*$/gm) || []).length;
		const detectedCorrect = (body.match(/Result — correct ✓/g) || []).length;
		const total = Number(parts.meta.quiz_total ?? detectedTotal);
		const correct = Number(parts.meta.quiz_correct ?? detectedCorrect);
		writeFileParts(file, {
			...parts.meta,
			type: "quiz",
			subject: subjectKey,
			topic: slug,
			phase,
			status: (parts.meta.status as string) || "active",
			updated: todayLocal(),
			quiz_correct: correct,
			quiz_total: total,
			quiz_score: total > 0 ? Math.round((correct / total) * 100) : 0,
		}, body);
	}

	function setQuizContext(topicInput: string, phase: QuizPhase): { file: string; slug: string } | null {
		if (!subjectDir) return null;
		const slug = slugify(topicInput);
		if (!slug) return null;
		const file = quizPath(slug, phase);
		if (!file) return null;
		ensureQuizFile(file, slug, phase);
		quizSlug = slug;
		quizPhase = phase;
		quizFile = file;
		return { file, slug };
	}

	function refreshRelations(file: string): void {
		const { meta, body } = readFileParts(file);
		const prerequisites = Array.isArray(meta.prerequisites) ? (meta.prerequisites as string[]) : [];
		const related = Array.isArray(meta.related) ? (meta.related as string[]) : [];
		const lines: string[] = [];
		if (prerequisites.length > 0) {
			lines.push("**Prerequisites**", ...prerequisites.map((slug) => `- [[${slug}]]`));
		}
		if (related.length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push("**Related**", ...related.map((slug) => `- [[${slug}]]`));
		}
		const nextBody = upsertSection(body, "Related Concepts", lines.join("\n"), "replace");
		writeFileParts(file, { ...meta, updated: todayLocal() }, nextBody);
	}

	function addBacklink(targetSlug: string, fromSlug: string): void {
		const target = topicPath(targetSlug);
		if (!target || !fs.existsSync(target)) return;
		const { meta } = readFileParts(target);
		const related = normalizeSlugList(
			[...(Array.isArray(meta.related) ? (meta.related as string[]) : []), fromSlug],
			targetSlug,
		);
		updateMetadata(target, { related });
		refreshRelations(target);
	}

	function nextQuizNumber(file: string): number {
		if (!fs.existsSync(file)) return 1;
		const { body } = readFileParts(file);
		const matches = [...body.matchAll(/^## Quiz (\d+)\s*$/gm)];
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
		details: any,
	): void {
		ensureQuizFile(file, slug, phase);
		const parts = readFileParts(file);
		const number = nextQuizNumber(file);
		const addition = `## Quiz ${number}\n\n${questionBlock}\n\n${resultBlock}`;
		const body = `${parts.body.trim()}\n\n${addition}`.trim();
		const counted = details?.status !== "cancelled" && details?.status !== "unavailable";
		const total = Number(parts.meta.quiz_total || 0) + (counted ? 1 : 0);
		const correct = Number(parts.meta.quiz_correct || 0) + (counted && details?.correct === true ? 1 : 0);
		const score = total > 0 ? Math.round((correct / total) * 100) : 0;
		writeFileParts(file, {
			...parts.meta,
			updated: todayLocal(),
			quiz_total: total,
			quiz_correct: correct,
			quiz_score: score,
		}, body);

		if (phase === "lesson" && counted) {
			const topic = topicPath(slug);
			if (topic && fs.existsSync(topic)) {
				const topicParts = readFileParts(topic);
				const topicTotal = Number(topicParts.meta.quiz_total || 0) + 1;
				const topicCorrect = Number(topicParts.meta.quiz_correct || 0) + (details?.correct === true ? 1 : 0);
				const topicScore = Math.round((topicCorrect / topicTotal) * 100);
				const confidenceBase = confidenceFromQuiz(topicCorrect, topicTotal);
				const confidence = details?.correct === true ? confidenceBase : Math.min(confidenceBase, 2);
				updateMetadata(topic, {
					quiz_total: topicTotal,
					quiz_correct: topicCorrect,
					quiz_score: topicScore,
					confidence,
					last_quiz_correct: details?.correct === true,
					status: details?.correct === true ? ((topicParts.meta.status as string) || "learning") : "learning",
				});
			}
		}
	}

	function evaluateTopic(file: string): {
		score: number;
		missing: string[];
		thin: string[];
		unresolvedMisconceptions: number;
		quizCorrect: number;
		quizTotal: number;
		lastQuizCorrect: boolean;
		ready: boolean;
	} {
		const { meta, body } = readFileParts(file);
		const missing: string[] = [];
		const thin: string[] = [];
		for (const section of TOPIC_REQUIRED_SECTIONS) {
			const value = getSection(body, section).trim();
			if (!value) missing.push(section);
			else if (value.replace(/[`*_#>\-\[\]]/g, "").trim().length < 35) thin.push(section);
		}
		const misconceptions = getSection(body, "Misconceptions");
		const unresolvedMisconceptions = (misconceptions.match(/^- \[ \] /gm) || []).length;
		const structuralScore = Math.round(((TOPIC_REQUIRED_SECTIONS.length - missing.length) / TOPIC_REQUIRED_SECTIONS.length) * 85);
		const frontmatterScore = meta.type === "topic" && meta.topic && meta.subject ? 10 : 0;
		const relationScore = new RegExp("^## Related Concepts\\s*$", "m").test(body) ? 5 : 0;
		const score = structuralScore + frontmatterScore + relationScore;
		const quizCorrect = Number(meta.quiz_correct || 0);
		const quizTotal = Number(meta.quiz_total || 0);
		const lastQuizCorrect = meta.last_quiz_correct === true;
		const ready = missing.length === 0 && unresolvedMisconceptions === 0 && score >= 90;
		return {
			score,
			missing,
			thin,
			unresolvedMisconceptions,
			quizCorrect,
			quizTotal,
			lastQuizCorrect,
			ready,
		};
	}

	function updateMisconceptionSection(
		file: string,
		misconception: string,
		correction: string,
		evidence: string | undefined,
		resolved: boolean,
	): void {
		const { meta, body } = readFileParts(file);
		const existing = getSection(body, "Misconceptions");
		const lines = existing
			.split("\n")
			.map((line) => line.trimEnd())
			.filter((line) => line.trim() && line.trim() !== "_None identified._");
		const prefix = resolved ? "- [x]" : "- [ ]";
		const evidencePart = evidence?.trim() ? ` Evidence: ${evidence.trim()}` : "";
		const entry = `${prefix} **Misconception:** ${misconception.trim()} — **Correction:** ${correction.trim()}.${evidencePart}`;
		const marker = `**Misconception:** ${misconception.trim()}`;
		const index = lines.findIndex((line) => line.includes(marker));
		if (index >= 0) lines[index] = entry;
		else lines.push(entry);
		const nextBody = upsertSection(body, "Misconceptions", lines.join("\n"), "replace");
		const currentConfidence = Number(meta.confidence || 1);
		writeFileParts(file, {
			...meta,
			updated: todayLocal(),
			status: resolved ? ((meta.status as string) || "learning") : "learning",
			confidence: resolved ? currentConfidence : Math.min(currentConfidence, 2),
		}, nextBody);
	}

	function activateLesson(
		ctx: any,
		topicInput: string,
		titleInput?: string,
		prerequisiteInputs?: string[],
		relatedInputs?: string[],
	): { file: string; slug: string; created: boolean; quizFile: string } | null {
		if (!subjectDir) return null;
		const slug = slugify(topicInput);
		if (!slug) return null;
		const prerequisites = prerequisiteInputs === undefined ? undefined : normalizeSlugList(prerequisiteInputs, slug);
		const related = relatedInputs === undefined ? undefined : normalizeSlugList(relatedInputs, slug);
		const result = ensureTopicFile(slug, titleInput, prerequisites, related);
		if (!result) return null;
		lessonSlug = slug;
		lessonFile = result.file;
		refreshRelations(result.file);
		const currentMeta = readFileParts(result.file).meta;
		const effectivePrerequisites = Array.isArray(currentMeta.prerequisites) ? (currentMeta.prerequisites as string[]) : [];
		const effectiveRelated = Array.isArray(currentMeta.related) ? (currentMeta.related as string[]) : [];
		for (const prerequisite of effectivePrerequisites) addBacklink(prerequisite, slug);
		for (const peer of effectiveRelated) addBacklink(peer, slug);
		const quiz = setQuizContext(slug, "lesson");
		if (!quiz) return null;
		lifecyclePhase = "teaching";
		persistState();

		if (ctx?.ui) {
			const theme = ctx.ui.theme;
			ctx.ui.setStatus(
				"lesson-log",
				theme.fg("accent", "📘 ") + theme.fg("dim", path.basename(result.file)),
			);
		}
		return { file: result.file, slug, created: result.created, quizFile: quiz.file };
	}

	pi.on("session_start", async (_event, ctx: any) => {
		let last: LessonState | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "lesson-log") last = entry.data as LessonState;
		}
		if (!last?.subjectDir) return;
		subjectDir = last.subjectDir;
		subjectKey = last.subjectKey ?? path.basename(subjectDir);
		sessionSlug = last.sessionSlug ?? null;
		sessionTitle = last.sessionTitle ?? null;
		lifecyclePhase = last.lifecyclePhase ?? "idle";
		ensureDirectories();

		if (last.planSlug) {
			planSlug = slugify(last.planSlug);
			const file = planPath(planSlug);
			if (file && fs.existsSync(file)) planFile = file;
		}
		if (last.lessonSlug) {
			lessonSlug = slugify(last.lessonSlug);
			const file = topicPath(lessonSlug);
			if (file && fs.existsSync(file)) lessonFile = file;
		}
		if (last.quizSlug && last.quizPhase) setQuizContext(last.quizSlug, last.quizPhase);
		else if (lessonSlug) setQuizContext(lessonSlug, "lesson");

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
			subjectDir = resolved;
			subjectKey = path.isAbsolute(raw) ? path.basename(resolved) : raw.replace(/\\/g, "/").replace(/^\.\//, "");
			ensureDirectories();
			sessionSlug = null;
			sessionTitle = null;
			lifecyclePhase = "idle";
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
		description: "Manual escape hatch: activate one concept note",
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
		description: "Stop active topic-note and quiz capture without marking the learning track complete",
		handler: async (_args, ctx: any) => {
			lessonFile = null;
			lessonSlug = null;
			quizFile = null;
			quizSlug = null;
			quizPhase = null;
			pendingQuizzes.clear();
			lifecyclePhase = "idle";
			persistState();
			ctx.ui.setStatus("lesson-log", undefined);
			ctx.ui.notify("Lesson logging stopped", "info");
		},
	});

	pi.registerCommand("lesson-status", {
		description: "Show learning subject, lifecycle, plan, topic note, and quiz target",
		handler: async (_args, ctx: any) => {
			ctx.ui.notify(
				`Learning directory: ${subjectDir ?? "(not set)"}\nLifecycle: ${lifecyclePhase}\nTrack: ${sessionSlug ?? "(not started)"}\nPlan: ${planFile ?? "(not active)"}\nTopic note: ${lessonFile ?? "(not active)"}\nQuiz file: ${quizFile ?? "(not active)"}`,
				"info",
			);
		},
	});

	pi.registerTool({
		name: "lesson_start",
		label: "lesson start",
		description:
			"Start an overall learning track. Creates/activates the standardized plan skeleton and diagnostic quiz file, resets concept state, and enters the diagnostic lifecycle phase. Call this once before the opening probe quiz.",
		promptSnippet:
			"At the beginning of a teach session, call lesson_start with the overall requested topic BEFORE the first diagnostic quiz.",
		promptGuidelines: [
			"Use one stable overall slug for lesson_start, the diagnostic, and lesson_plan.",
			"Call this before diagnostic probing; do not call lesson_note first.",
			"Starting a new track resets only active lesson state, not existing files on disk.",
		],
		parameters: LessonStartParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!subjectDir) {
				return {
					content: [{ type: "text", text: "No learning directory is configured. Ask the user to run /learn <subject-directory> first." }],
					details: { status: "no-subject" },
				};
			}
			const slug = slugify(params.topic);
			if (!slug) {
				return { content: [{ type: "text", text: "Invalid overall lesson topic." }], details: { status: "invalid-topic" } };
			}
			sessionSlug = slug;
			sessionTitle = params.title?.trim() || titleFromSlug(slug);
			planSlug = slug;
			planFile = ensurePlanFile(slug, sessionTitle);
			lessonFile = null;
			lessonSlug = null;
			pendingQuizzes.clear();
			const quiz = setQuizContext(slug, "diagnostic");
			if (!planFile || !quiz) {
				return { content: [{ type: "text", text: "Could not initialize lesson files." }], details: { status: "error" } };
			}
			updateMetadata(planFile, { status: "active" });
			updateMetadata(quiz.file, { status: "active" });
			lifecyclePhase = "diagnostic";
			persistState();
			return {
				content: [{ type: "text", text: `Started learning track ${slug}. Diagnostic quizzes: ${quiz.file}. Plan: ${planFile}` }],
				details: { status: "diagnostic", topic: slug, planFile, quizFile: quiz.file },
			};
		},
	});

	pi.registerTool({
		name: "lesson_quiz_context",
		label: "lesson quiz context",
		description:
			"Manual routing override for a quiz file. Normal flow uses lesson_start for diagnostics and lesson_note for lesson quizzes.",
		promptSnippet:
			"Normally do not call this: lesson_start routes diagnostics and lesson_note routes concept quizzes automatically.",
		parameters: LessonQuizContextParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!subjectDir) {
				return { content: [{ type: "text", text: "No learning directory configured." }], details: { status: "no-subject" } };
			}
			const result = setQuizContext(params.topic, params.phase as QuizPhase);
			if (!result) {
				return { content: [{ type: "text", text: "Invalid quiz context." }], details: { status: "invalid-topic" } };
			}
			persistState();
			return { content: [{ type: "text", text: `Quiz context set: ${result.file}` }], details: { status: "active", ...result, phase: params.phase } };
		},
	});

	pi.registerTool({
		name: "lesson_plan",
		label: "lesson plan",
		description:
			"Create/update the standardized overall learning plan after diagnostic probing and whenever quiz evidence meaningfully changes the graph. Each named section is replaced in place; this is not append-only logging.",
		promptSnippet:
			"After the diagnostic, call lesson_plan with the complete current adaptive roadmap. Re-call it after meaningful progress, a prerequisite gap, or a sequence change.",
		promptGuidelines: [
			"The diagnostic must materially influence Starting Point and Learning Sequence.",
			"If diagnostic evidence proves a node is already mastered, mark it checked/skipped rather than reteaching it by default.",
			"If lesson quizzes expose a prerequisite gap or repeated miss, revise the dependency map/sequence before advancing.",
			"Keep the plan current, concise, and free of full lesson prose or quiz transcripts.",
		],
		parameters: LessonPlanParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!subjectDir) {
				return { content: [{ type: "text", text: "No learning directory configured." }], details: { status: "no-subject" } };
			}
			const slug = slugify(params.topic);
			if (!slug) {
				return { content: [{ type: "text", text: "Invalid lesson plan topic." }], details: { status: "invalid-topic" } };
			}
			const file = ensurePlanFile(slug, params.title);
			if (!file) {
				return { content: [{ type: "text", text: "Could not create plan file." }], details: { status: "error" } };
			}
			let { meta, body } = readFileParts(file);
			body = upsertSection(body, "Goal", params.goal, "replace");
			body = upsertSection(body, "Starting Point", params.startingPoint, "replace");
			body = upsertSection(body, "Dependency Map", params.dependencyMap, "replace");
			body = upsertSection(body, "Learning Sequence", params.learningSequence, "replace");
			body = upsertSection(body, "Progress", params.progress, "replace");
			body = upsertSection(body, "Current Position", params.currentPosition, "replace");
			body = upsertSection(body, "Next", params.next, "replace");
			meta = { ...meta, type: "plan", subject: subjectKey || "", topic: slug, status: "active", updated: todayLocal() };
			writeFileParts(file, meta, body);
			planSlug = slug;
			planFile = file;
			sessionSlug = sessionSlug || slug;
			sessionTitle = sessionTitle || params.title?.trim() || titleFromSlug(slug);
			if (quizFile && quizPhase === "diagnostic") updateMetadata(quizFile, { status: "completed" });
			lifecyclePhase = "planning";
			persistState();
			return { content: [{ type: "text", text: `Updated learning plan: ${file}` }], details: { status: "written", file, topic: slug } };
		},
	});

	pi.registerTool({
		name: "lesson_note",
		label: "lesson note",
		description:
			"Activate/create a standardized concept note under topic/. Also records prerequisite/related relationships, updates backlinks in existing related notes, and routes subsequent quizzes to quiz/<concept>-lesson.md.",
		promptSnippet:
			"Before teaching each distinct concept, call lesson_note with its stable slug and graph relationships, then write into named sections with lesson_write.",
		promptGuidelines: [
			"Pass prerequisites from the approved/current dependency graph whenever known.",
			"Reuse the same topic slug on revisits.",
			"Do not create a new topic for a clarification or another example of the same concept.",
		],
		parameters: LessonNoteParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!subjectDir) {
				return { content: [{ type: "text", text: "No learning directory configured." }], details: { status: "no-subject" } };
			}
			const result = activateLesson(ctx, params.topic, params.title, params.prerequisites, params.related);
			if (!result) {
				return { content: [{ type: "text", text: "Invalid concept topic." }], details: { status: "invalid-topic" } };
			}
			return {
				content: [{ type: "text", text: `${result.created ? "Created" : "Activated"} topic note: ${result.file}. Lesson quizzes route to: ${result.quizFile}` }],
				details: { status: "active", file: result.file, topic: result.slug, created: result.created, quizFile: result.quizFile },
			};
		},
	});

	pi.registerTool({
		name: "lesson_write",
		label: "lesson write",
		description:
			"Update one semantic section of the active topic note. Replacement is the default so notes converge toward a clean current explanation instead of accumulating duplicate fragments.",
		promptSnippet:
			"Write durable knowledge by section with lesson_write. Prefer mode='replace'; append only for genuinely additive examples or notes.",
		promptGuidelines: [
			"Never include the section heading itself; the extension owns headings.",
			"Use standalone prose that remains useful without the chat.",
			"Do not write quiz content or misconceptions here; quizzes are automatic and misconceptions use lesson_misconception.",
			"When clarification improves an existing explanation, replace that section with the improved complete version rather than appending a correction fragment.",
		],
		parameters: LessonWriteParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!lessonFile) {
				return { content: [{ type: "text", text: "No active topic note. Call lesson_note first." }], details: { status: "no-lesson" } };
			}
			const content = params.content.trim();
			if (!content) {
				return { content: [{ type: "text", text: "Nothing written: empty content." }], details: { status: "empty" } };
			}
			const heading = TOPIC_SECTION_MAP[params.section as TopicSectionKey];
			const mode = (params.mode || "replace") as "replace" | "append";
			const target = lessonFile;
			await withLock(() => {
				const { meta, body } = readFileParts(target);
				const nextBody = upsertSection(body, heading, content, mode);
				writeFileParts(target, { ...meta, updated: todayLocal() }, nextBody);
			});
			return { content: [{ type: "text", text: `${mode === "replace" ? "Updated" : "Appended to"} ${heading} in ${target}` }], details: { status: "written", file: target, section: heading, mode } };
		},
	});

	pi.registerTool({
		name: "lesson_misconception",
		label: "lesson misconception",
		description:
			"Record or resolve a genuine misconception in the active concept note. Unresolved misconceptions are checklist items and block concept completion until corrected.",
		promptSnippet:
			"When probing or a lesson quiz reveals a real mistaken mental model (not merely a careless miss), record it with lesson_misconception. During diagnostics, pass topic to target the appropriate concept note. Mark the same misconception resolved after evidence shows correction.",
		promptGuidelines: [
			"Do not infer a misconception without enough evidence; a single wrong click may just be a slip.",
			"Phrase the correction as the replacement mental model, not just 'the answer was X'.",
			"After reteaching and successful verification, call this again with resolved=true using the same misconception wording.",
		],
		parameters: LessonMisconceptionParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			let target = lessonFile;
			if (params.topic) {
				const targetSlug = slugify(params.topic);
				if (!targetSlug) {
					return { content: [{ type: "text", text: "Invalid misconception topic." }], details: { status: "invalid-topic" } };
				}
				const ensured = ensureTopicFile(targetSlug);
				target = ensured?.file ?? null;
			}
			if (!target) {
				return { content: [{ type: "text", text: "No active topic note. During a diagnostic, provide topic with the stable concept slug." }], details: { status: "no-lesson" } };
			}
			await withLock(() => updateMisconceptionSection(
				target!,
				params.misconception,
				params.correction,
				params.evidence,
				params.resolved === true,
			));
			return {
				content: [{ type: "text", text: `${params.resolved === true ? "Resolved" : "Recorded"} misconception in ${target}` }],
				details: { status: params.resolved === true ? "resolved" : "recorded", file: target },
			};
		},
	});

	pi.registerTool({
		name: "lesson_quality",
		label: "lesson quality",
		description:
			"Mechanically audit the active concept note before declaring it complete. Checks standardized sections, thin/missing content, unresolved misconceptions, and quiz evidence. The model must still perform a semantic accuracy/redundancy audit itself.",
		promptSnippet:
			"Before marking a concept complete, call lesson_quality, repair missing/thin sections, and ensure the note is accurate, standalone, non-redundant, and free of transcript filler.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			if (!lessonFile) {
				return { content: [{ type: "text", text: "No active topic note." }], details: { status: "no-lesson" } };
			}
			const report = evaluateTopic(lessonFile);
			const text = [
				`Mechanical note quality: ${report.score}/100.`,
				`Missing required sections: ${report.missing.length ? report.missing.join(", ") : "none"}.`,
				`Thin sections to review: ${report.thin.length ? report.thin.join(", ") : "none"}.`,
				`Unresolved misconceptions: ${report.unresolvedMisconceptions}.`,
				`Lesson quiz evidence: ${report.quizCorrect}/${report.quizTotal} correct.`,
				`Structurally ready: ${report.ready ? "yes" : "no"}. Also perform a semantic audit for accuracy, standalone clarity, redundancy, and conversational filler.`,
			].join("\n");
			return { content: [{ type: "text", text }], details: { status: "reviewed", file: lessonFile, ...report } };
		},
	});

	pi.registerTool({
		name: "lesson_progress",
		label: "lesson progress",
		description:
			"Set the active concept's learning status. Completion is gated by note quality, unresolved misconceptions, and the most recent lesson quiz so quiz performance actually controls advancement.",
		promptSnippet:
			"After teaching/quiz feedback, use lesson_progress. Do not mark complete after a miss; reteach/requiz and adapt the plan first.",
		promptGuidelines: [
			"Use status='blocked' when a prerequisite gap is discovered and revise lesson_plan accordingly.",
			"Use status='complete' only after lesson_quality passes, misconceptions are resolved, and the latest quiz is correct.",
			"After meaningful status changes, update lesson_plan so the roadmap reflects the evidence.",
		],
		parameters: LessonProgressParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!lessonFile) {
				return { content: [{ type: "text", text: "No active topic note." }], details: { status: "no-lesson" } };
			}
			const requested = params.status as TopicStatus;
			const report = evaluateTopic(lessonFile);
			if (requested === "complete") {
				const blockers: string[] = [];
				if (!report.ready) blockers.push("note quality/misconceptions");
				if (report.quizTotal < 1) blockers.push("no lesson quiz evidence");
				if (report.quizTotal >= 1 && !report.lastQuizCorrect) blockers.push("most recent lesson quiz was not correct");
				if (blockers.length > 0) {
					updateMetadata(lessonFile, { status: "learning" });
					return {
						content: [{ type: "text", text: `Cannot mark concept complete yet: ${blockers.join("; ")}. Reteach/fix the note, resolve misconceptions, requiz, and adapt the plan if needed.` }],
						details: { status: "completion-blocked", blockers, ...report },
					};
				}
			}
			updateMetadata(lessonFile, { status: requested });
			if (requested === "complete" && quizFile && quizPhase === "lesson" && fs.existsSync(quizFile)) {
				updateMetadata(quizFile, { status: "completed" });
			}
			return {
				content: [{ type: "text", text: `Concept status set to ${requested}${params.reason ? `: ${params.reason}` : ""}. Update the overall plan if this changes progress or sequence.` }],
				details: { status: requested, file: lessonFile, topic: lessonSlug, reason: params.reason || null },
			};
		},
	});

	pi.registerTool({
		name: "lesson_finish",
		label: "lesson finish",
		description:
			"Finish the overall learning track lifecycle. Normally refuses while the plan still has unchecked learning-sequence items; use force only if the learner explicitly wants to end early.",
		promptSnippet:
			"When the approved learning track is genuinely done, update the plan one final time, then call lesson_finish.",
		parameters: LessonFinishParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!planFile || !fs.existsSync(planFile)) {
				return { content: [{ type: "text", text: "No active learning plan to finish." }], details: { status: "no-plan" } };
			}
			const { meta, body } = readFileParts(planFile);
			const sequence = getSection(body, "Learning Sequence");
			const unchecked = countUncheckedItems(sequence);
			if (unchecked > 0 && params.force !== true) {
				return {
					content: [{ type: "text", text: `Cannot finish yet: ${unchecked} unchecked learning-sequence item(s) remain. Complete/update the plan, or only use force if the learner explicitly wants to stop early.` }],
					details: { status: "finish-blocked", unchecked },
				};
			}
			let nextBody = body;
			if (params.summary?.trim()) nextBody = upsertSection(nextBody, "Progress", params.summary.trim(), "replace");
			nextBody = upsertSection(nextBody, "Current Position", "Completed", "replace");
			nextBody = upsertSection(nextBody, "Next", "Track complete.", "replace");
			writeFileParts(planFile, { ...meta, status: "completed", updated: todayLocal() }, nextBody);
			if (quizFile && fs.existsSync(quizFile)) updateMetadata(quizFile, { status: "completed" });
			lifecyclePhase = "finished";
			persistState();
			return { content: [{ type: "text", text: `Finished learning track ${sessionSlug || planSlug || ""}.` }], details: { status: "finished", planFile } };
		},
	});

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
		const returnPhase = lifecyclePhase;
		pendingQuizzes.set(toolCallId, {
			file: quizFile,
			slug: quizSlug,
			phase: quizPhase,
			questionBlock: buildQuizQuestionBlock(
				String(input.question || ""),
				input.details?.trim() || undefined,
				options,
			),
			returnPhase,
		});
		lifecyclePhase = quizPhase === "diagnostic" ? "diagnostic" : "quiz";
		persistState();
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
			const options: Array<{ index: number; label: string }> = Array.isArray(details?.options) ? details.options : [];
			questionBlock = buildQuizQuestionBlock(
				String(details?.question || ""),
				details?.context?.trim() || undefined,
				options,
			);
		}
		const resultBlock = buildQuizResultBlock(details);
		await withLock(() => appendQuizUnit(targetFile, targetSlug, targetPhase, questionBlock!, resultBlock, details));
		if (toolCallId) pendingQuizzes.delete(toolCallId);
		lifecyclePhase = pending?.returnPhase ?? (targetPhase === "diagnostic" ? "diagnostic" : "teaching");
		persistState();
	});
}
