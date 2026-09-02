/**
 * coding-assessment — first-class coding exercises for lesson-log.
 *
 * Coding exercises are assessment evidence, not topic prose. They are written
 * into the currently active quiz file and update the same quiz/mastery metadata
 * used by lesson-log so implementation-heavy concepts can be gated on actual
 * code, not recognition-only multiple choice.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

type QuizPhase = "diagnostic" | "lesson";
type MetaValue = string | number | boolean | string[];

type LessonLogState = {
	subjectDir?: string | null;
	lessonSlug?: string | null;
	quizFile?: string | null;
	quizSlug?: string | null;
	quizPhase?: QuizPhase | null;
};

type PendingExercise = {
	exerciseId: string;
	file: string;
	subjectDir: string;
	slug: string;
	phase: QuizPhase;
	language: string;
	number: number;
	attempts: number;
};

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
	"code_exercise_correct",
	"code_exercise_total",
	"last_code_exercise_correct",
] as const;

const CodeExerciseParams = Type.Object({
	prompt: Type.String({
		description:
			"Self-contained coding task that tests implementation or debugging ability for the current concept. Do not include the solution.",
	}),
	language: Type.Optional(
		Type.String({ description: "Programming language for the exercise, e.g. python, typescript, sql, bash. Defaults to text." }),
	),
	starterCode: Type.Optional(
		Type.String({ description: "Optional starter code or function signature. Keep it minimal; do not reveal the solution." }),
	),
	criteria: Type.Array(Type.String(), {
		description:
			"Objective acceptance criteria used to grade the submission. Prefer observable behavior, edge cases, constraints, or tests over vague style judgments.",
		minItems: 1,
	}),
});

const CodeResultParams = Type.Object({
	exerciseId: Type.String({ description: "Exercise id returned by lesson_code_exercise." }),
	submission: Type.String({ description: "The learner's submitted code exactly as evaluated." }),
	correct: Type.Boolean({ description: "True only when the submission satisfies the stated acceptance criteria." }),
	feedback: Type.String({
		description:
			"Concise evidence-based grading feedback. State what passed/failed and why; do not invent test results that were not actually checked.",
	}),
	testEvidence: Type.Optional(
		Type.String({
			description:
				"Optional concise test/compiler/runtime evidence when the code was actually executed. Include only evidence that was observed.",
		}),
	),
});

function todayLocal(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function slugify(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
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
	fs.writeFileSync(file, `${renderFrontmatter(meta)}\n\n${body.trim()}\n`, "utf-8");
}

function getLessonLogState(ctx: any): LessonLogState | null {
	let last: LessonLogState | null = null;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === "lesson-log") {
			last = entry.data as LessonLogState;
		}
	}
	return last;
}

function nextExerciseNumber(file: string): number {
	if (!fs.existsSync(file)) return 1;
	const { body } = readFileParts(file);
	const matches = [...body.matchAll(/^## Coding Exercise (\d+)\s*$/gm)];
	let max = 0;
	for (const match of matches) {
		const value = Number(match[1]);
		if (Number.isFinite(value) && value > max) max = value;
	}
	return max + 1;
}

function fence(language: string, code: string): string {
	const safeLanguage = language.replace(/[^A-Za-z0-9_+#.-]/g, "");
	const runs: string[] = code.match(/`+/g) ?? [];
	let longest = 0;
	for (const run of runs) longest = Math.max(longest, run.length);
	const ticks = "`".repeat(Math.max(3, longest + 1));
	return `${ticks}${safeLanguage}\n${code.trim()}\n${ticks}`;
}

function confidenceFromAssessment(correct: number, total: number): number {
	if (total >= 5 && correct / total >= 0.9) return 5;
	if (total >= 3 && correct / total >= 0.8) return 4;
	if (total >= 2 && correct / total >= 0.6) return 3;
	if (correct >= 1) return 2;
	return 1;
}

function updateAssessmentStats(file: string, correctResult: boolean): void {
	if (!fs.existsSync(file)) return;
	const { meta, body } = readFileParts(file);
	const total = Number(meta.quiz_total || 0) + 1;
	const correct = Number(meta.quiz_correct || 0) + (correctResult ? 1 : 0);
	const codeTotal = Number(meta.code_exercise_total || 0) + 1;
	const codeCorrect = Number(meta.code_exercise_correct || 0) + (correctResult ? 1 : 0);
	writeFileParts(file, {
		...meta,
		updated: todayLocal(),
		quiz_total: total,
		quiz_correct: correct,
		quiz_score: Math.round((correct / total) * 100),
		code_exercise_total: codeTotal,
		code_exercise_correct: codeCorrect,
		last_code_exercise_correct: correctResult,
	}, body);
}

function updateTopicMastery(subjectDir: string, slug: string, correctResult: boolean): void {
	const topic = path.join(subjectDir, "topic", `${slug}.md`);
	if (!fs.existsSync(topic)) return;
	const { meta, body } = readFileParts(topic);
	const total = Number(meta.quiz_total || 0) + 1;
	const correct = Number(meta.quiz_correct || 0) + (correctResult ? 1 : 0);
	const codeTotal = Number(meta.code_exercise_total || 0) + 1;
	const codeCorrect = Number(meta.code_exercise_correct || 0) + (correctResult ? 1 : 0);
	const confidenceBase = confidenceFromAssessment(correct, total);
	const confidence = correctResult ? confidenceBase : Math.min(confidenceBase, 2);
	writeFileParts(topic, {
		...meta,
		updated: todayLocal(),
		quiz_total: total,
		quiz_correct: correct,
		quiz_score: Math.round((correct / total) * 100),
		last_quiz_correct: correctResult,
		code_exercise_total: codeTotal,
		code_exercise_correct: codeCorrect,
		last_code_exercise_correct: correctResult,
		confidence,
		status: correctResult ? ((meta.status as string) || "learning") : "learning",
	}, body);
}

export default function codingAssessment(pi: ExtensionAPI) {
	const pending = new Map<string, PendingExercise>();

	pi.on("session_start", async (_event, ctx: any) => {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== "coding-assessment") continue;
			const data = entry.data as any;
			if (!data?.exerciseId) continue;
			if (data.completed === true) pending.delete(data.exerciseId);
			else pending.set(data.exerciseId, data as PendingExercise);
		}
	});

	pi.registerTool({
		name: "lesson_code_exercise",
		label: "lesson code exercise",
		description:
			"Create and log a coding exercise in the currently active lesson/diagnostic quiz file. Use when full understanding requires implementing, debugging, transforming, querying, or wiring code rather than merely recognizing a correct statement. After calling this tool, present the exercise to the learner and wait for their code; do not reveal the solution.",
		promptSnippet:
			"When the teach skill reaches a quiz-check for a programming concept whose objective includes writing, debugging, configuring, or querying code, satisfy that check with lesson_code_exercise instead of a recognition-only multiple-choice quiz. A passed coding exercise counts as the quiz-check; do not add an MCQ solely to satisfy the wording of teach.",
		promptGuidelines: [
			"Use coding exercises for programming concepts where knowing the idea is insufficient without being able to implement or debug it.",
			"Do not force code onto conceptual topics that do not need implementation competence.",
			"Keep the task concept-sized: test the current node, not an unrelated mini-project.",
			"State objective acceptance criteria before the learner answers.",
			"Do not include the solution, solution-shaped pseudocode, or hidden implementation hints in the prompt/starter code.",
			"After the learner submits code, verify it against the stated criteria. When feasible and safe, actually run/compile/test the submission rather than grading by inspection alone.",
		],
		parameters: CodeExerciseParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: any) {
			const state = getLessonLogState(ctx);
			const subjectDir = state?.subjectDir || null;
			const file = state?.quizFile || null;
			const slug = slugify(state?.quizSlug || state?.lessonSlug || "");
			const phase = state?.quizPhase || null;
			if (!subjectDir || !file || !slug || (phase !== "diagnostic" && phase !== "lesson")) {
				return {
					content: [{ type: "text", text: "No active lesson assessment target. Start the learning track with lesson_start or activate a concept with lesson_note first." }],
					details: { status: "no-assessment" },
				};
			}

			const number = nextExerciseNumber(file);
			const exerciseId = `${slug}-code-${number}`;
			const language = params.language?.trim() || "text";
			const criteria = params.criteria.map((criterion: string) => criterion.trim()).filter(Boolean);
			const parts = readFileParts(file);
			const block: string[] = [
				`## Coding Exercise ${number}`,
				"",
				"> [!question] Coding Exercise",
				...params.prompt.trim().split("\n").map((line: string) => (line ? `> ${line}` : ">")),
				"",
				"### Acceptance Criteria",
				...criteria.map((criterion: string) => `- ${criterion}`),
			];
			if (params.starterCode?.trim()) {
				block.push("", "### Starter Code", "", fence(language, params.starterCode));
			}
			const nextBody = `${parts.body.trim()}\n\n${block.join("\n")}`.trim();
			writeFileParts(file, { ...parts.meta, updated: todayLocal() }, nextBody);

			const exercise: PendingExercise = { exerciseId, file, subjectDir, slug, phase, language, number, attempts: 0 };
			pending.set(exerciseId, exercise);
			pi.appendEntry("coding-assessment", { ...exercise, completed: false });

			return {
				content: [{ type: "text", text: `Logged coding exercise ${exerciseId} in ${file}. Present the task to the learner and wait for their code before grading.` }],
				details: { status: "awaiting-submission", exerciseId, file, topic: slug, phase, language, criteria },
			};
		},
	});

	pi.registerTool({
		name: "lesson_code_result",
		label: "lesson code result",
		description:
			"Record the learner's submitted code and the verified result for a coding exercise. This counts as assessment evidence in the same mastery statistics used by lesson quizzes. Incorrect coding exercises block normal completion until the concept is repaired and subsequently verified.",
		promptSnippet:
			"After evaluating a lesson_code_exercise submission, call lesson_code_result with the exact submitted code, pass/fail, and evidence-based feedback. Then adapt/reteach/retest exactly as you would after a quiz miss.",
		promptGuidelines: [
			"Do not mark correct unless every stated acceptance criterion is satisfied.",
			"If you executed tests, report only the actual observed evidence in testEvidence.",
			"If the submission is wrong, explain the decisive gap without immediately dumping the full solution; teach the missing concept and let the learner try again when appropriate.",
			"If the failure reveals a genuine wrong mental model, also use lesson_misconception and adapt lesson_plan when needed.",
		],
		parameters: CodeResultParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx: any) {
			const exercise = pending.get(params.exerciseId);
			if (!exercise) {
				return {
					content: [{ type: "text", text: `Unknown or already-completed coding exercise: ${params.exerciseId}` }],
					details: { status: "unknown-exercise" },
				};
			}

			const parts = readFileParts(exercise.file);
			const resultType = params.correct ? "success" : "failure";
			const resultTitle = params.correct ? "Result — correct ✓" : "Result — incorrect ✗";
			const attempt = exercise.attempts + 1;
			const block: string[] = [
				`### Attempt ${attempt} — Submission`,
				"",
				fence(exercise.language, params.submission),
				"",
				`> [!${resultType}] ${resultTitle}`,
				...params.feedback.trim().split("\n").map((line: string) => (line ? `> ${line}` : ">")),
			];
			if (params.testEvidence?.trim()) {
				block.push(
					"",
					"> [!info] Test Evidence",
					...params.testEvidence.trim().split("\n").map((line: string) => (line ? `> ${line}` : ">")),
				);
			}
			const nextBody = `${parts.body.trim()}\n\n${block.join("\n")}`.trim();
			writeFileParts(exercise.file, { ...parts.meta, updated: todayLocal() }, nextBody);
			updateAssessmentStats(exercise.file, params.correct);
			if (exercise.phase === "lesson") updateTopicMastery(exercise.subjectDir, exercise.slug, params.correct);

			exercise.attempts = attempt;
			if (params.correct) pending.delete(params.exerciseId);
			else pending.set(params.exerciseId, exercise);
			pi.appendEntry("coding-assessment", { ...exercise, completed: params.correct, correct: params.correct });

			return {
				content: [{
					type: "text",
					text: params.correct
						? `Passed coding exercise ${params.exerciseId}. Assessment metadata updated.`
						: `Attempt ${attempt} failed for ${params.exerciseId}. Assessment metadata updated; the same exercise remains open for a revised submission.`,
				}],
				details: {
					status: params.correct ? "correct" : "incorrect",
					exerciseId: params.exerciseId,
					file: exercise.file,
					topic: exercise.slug,
					phase: exercise.phase,
				},
			};
		},
	});
}
