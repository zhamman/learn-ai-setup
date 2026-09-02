/**
 * obsidian-assessment — Obsidian-first lesson delivery and assessment submission.
 *
 * During an active lesson-log track:
 *   - durable lesson content must be written before lesson-phase assessment
 *   - built-in terminal quiz is replaced by lesson_obsidian_quiz
 *   - multiple-choice answers can be submitted by checking boxes in Obsidian
 *   - coding submissions can be edited and submitted from Obsidian
 *   - file submissions trigger a Pi turn automatically
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

type QuizPhase = "diagnostic" | "lesson";
type MetaValue = string | number | boolean | string[];

type LessonLogState = {
	subjectDir?: string | null;
	sessionSlug?: string | null;
	lifecyclePhase?: string | null;
	lessonFile?: string | null;
	lessonSlug?: string | null;
	quizFile?: string | null;
	quizSlug?: string | null;
	quizPhase?: QuizPhase | null;
};

type PendingObsidianQuiz = {
	assessmentId: string;
	file: string;
	subjectDir: string;
	slug: string;
	phase: QuizPhase;
	number: number;
	question: string;
	options: string[];
	correctIndex: number;
	explanation: string;
};

type PendingCodeSubmission = {
	exerciseId: string;
	file: string;
	subjectDir: string;
	slug: string;
	phase: QuizPhase;
	language: string;
	criteria: string[];
	prompt: string;
	lastSubmission?: string;
	awaitingGrade: boolean;
};

type CapturedCodeCall = {
	prompt: string;
	language?: string;
	starterCode?: string;
	criteria: string[];
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

const ObsidianQuizParams = Type.Object({
	question: Type.String({
		description: "Self-contained objectively gradable question. Do not include the answer in the stem.",
	}),
	options: Type.Array(Type.String(), {
		description: "Distinct plausible answer choices. Exactly one must be correct.",
		minItems: 2,
		maxItems: 6,
	}),
	correctIndex: Type.Integer({
		description: "1-based index of the single correct option.",
		minimum: 1,
	}),
	explanation: Type.String({
		description: "Concise explanation shown only after submission, including why the correct answer is correct.",
	}),
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
		if (entry.type === "custom" && entry.customType === "lesson-log") last = entry.data as LessonLogState;
	}
	return last;
}

function activeLearning(state: LessonLogState | null): state is LessonLogState {
	if (!state?.subjectDir || !state.sessionSlug) return false;
	return state.lifecyclePhase !== "idle" && state.lifecyclePhase !== "finished";
}

function getSection(body: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`^## ${escaped}\\s*$`, "m").exec(body);
	if (!match) return "";
	const start = match.index + match[0].length;
	const rest = body.slice(start);
	const next = /^##\s+/m.exec(rest);
	const end = next ? start + next.index : body.length;
	return body.slice(start, end).trim();
}

function topicReadyForAssessment(state: LessonLogState): boolean {
	const file = state.lessonFile;
	if (!file || !fs.existsSync(file)) return false;
	const { body } = readFileParts(file);
	const core = getSection(body, "Core Idea").replace(/[_*`#>\-\[\]]/g, "").trim();
	const support = ["Why It Exists", "Mental Model", "How It Works", "Example"]
		.map((heading) => getSection(body, heading).replace(/[_*`#>\-\[\]]/g, "").trim())
		.some((value) => value.length >= 20);
	return core.length >= 20 && support;
}

function nextQuizNumber(file: string): number {
	if (!fs.existsSync(file)) return 1;
	const { body } = readFileParts(file);
	const matches = [...body.matchAll(/^## Quiz (\d+)\s*$/gm)];
	let max = 0;
	for (const match of matches) max = Math.max(max, Number(match[1]) || 0);
	return max + 1;
}

function fence(language: string, code: string): string {
	const safeLanguage = language.replace(/[^A-Za-z0-9_+#.-]/g, "");
	const runs = code.match(/`+/g) ?? [];
	let longest = 0;
	for (const run of runs) longest = Math.max(longest, run.length);
	const ticks = "`".repeat(Math.max(3, longest + 1));
	return `${ticks}${safeLanguage}\n${code}\n${ticks}`;
}

function confidenceFromAssessment(correct: number, total: number): number {
	if (total >= 5 && correct / total >= 0.9) return 5;
	if (total >= 3 && correct / total >= 0.8) return 4;
	if (total >= 2 && correct / total >= 0.6) return 3;
	if (correct >= 1) return 2;
	return 1;
}

function updateQuizStats(file: string, correctResult: boolean): void {
	if (!fs.existsSync(file)) return;
	const { meta, body } = readFileParts(file);
	const total = Number(meta.quiz_total || 0) + 1;
	const correct = Number(meta.quiz_correct || 0) + (correctResult ? 1 : 0);
	writeFileParts(file, {
		...meta,
		updated: todayLocal(),
		quiz_total: total,
		quiz_correct: correct,
		quiz_score: Math.round((correct / total) * 100),
	}, body);
}

function updateTopicStats(subjectDir: string, slug: string, correctResult: boolean): void {
	const file = path.join(subjectDir, "topic", `${slug}.md`);
	if (!fs.existsSync(file)) return;
	const { meta, body } = readFileParts(file);
	const total = Number(meta.quiz_total || 0) + 1;
	const correct = Number(meta.quiz_correct || 0) + (correctResult ? 1 : 0);
	const confidenceBase = confidenceFromAssessment(correct, total);
	const confidence = correctResult ? confidenceBase : Math.min(confidenceBase, 2);
	writeFileParts(file, {
		...meta,
		updated: todayLocal(),
		quiz_total: total,
		quiz_correct: correct,
		quiz_score: Math.round((correct / total) * 100),
		last_quiz_correct: correctResult,
		confidence,
		status: correctResult ? ((meta.status as string) || "learning") : "learning",
	}, body);
}

function setTopicLastAssessment(subjectDir: string, slug: string, correctResult: boolean): void {
	const file = path.join(subjectDir, "topic", `${slug}.md`);
	if (!fs.existsSync(file)) return;
	const { meta, body } = readFileParts(file);
	writeFileParts(file, { ...meta, updated: todayLocal(), last_quiz_correct: correctResult }, body);
}

function appendToBody(file: string, addition: string): void {
	const { meta, body } = readFileParts(file);
	writeFileParts(file, { ...meta, updated: todayLocal() }, `${body.trim()}\n\n${addition.trim()}`);
}

function sectionForMarker(text: string, marker: string, explicitEnd?: string): { start: number; end: number; text: string } | null {
	const start = text.indexOf(marker);
	if (start < 0) return null;
	let end: number;
	if (explicitEnd) {
		const endIndex = text.indexOf(explicitEnd, start + marker.length);
		end = endIndex >= 0 ? endIndex + explicitEnd.length : text.length;
	} else {
		const rest = text.slice(start + marker.length);
		const next = /^##\s+/m.exec(rest);
		end = next ? start + marker.length + next.index : text.length;
	}
	return { start, end, text: text.slice(start, end) };
}

export default function obsidianAssessment(pi: ExtensionAPI) {
	const pendingQuizzes = new Map<string, PendingObsidianQuiz>();
	const pendingCode = new Map<string, PendingCodeSubmission>();
	const capturedCodeCalls = new Map<string, CapturedCodeCall>();
	const watchedFiles = new Set<string>();
	let writeLock: Promise<void> = Promise.resolve();

	function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const previous = writeLock;
		let release!: () => void;
		writeLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		return previous.then(fn).finally(() => release());
	}

	function persistQuiz(quiz: PendingObsidianQuiz, completed: boolean): void {
		pi.appendEntry("obsidian-quiz-assessment", { ...quiz, completed });
	}

	function persistCode(code: PendingCodeSubmission, completed: boolean): void {
		pi.appendEntry("obsidian-code-submit", { ...code, completed });
	}

	function sendAssessmentEvent(content: string, details: Record<string, unknown>): void {
		pi.sendMessage(
			{
				customType: "obsidian-assessment-submission",
				content,
				display: false,
				details,
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	async function gradeCheckedQuiz(quiz: PendingObsidianQuiz, selectedIndex: number): Promise<void> {
		if (!pendingQuizzes.has(quiz.assessmentId)) return;
		const correct = selectedIndex === quiz.correctIndex;
		await withLock(() => {
			const fileText = fs.readFileSync(quiz.file, "utf-8");
			const marker = `<!-- obsidian-quiz-id:${quiz.assessmentId} -->`;
			const section = sectionForMarker(fileText, marker);
			if (!section) return;
			const selected = quiz.options[selectedIndex - 1] || "(unknown)";
			const correctLabel = quiz.options[quiz.correctIndex - 1] || "(unknown)";
			const result = [
				"",
				`> [!${correct ? "success" : "failure"}] Result — ${correct ? "correct ✓" : "incorrect ✗"}`,
				`> Your answer: ${selectedIndex}. ${selected}`,
				`> Correct answer: ${quiz.correctIndex}. ${correctLabel}`,
				">",
				...quiz.explanation.split("\n").map((line) => (line ? `> ${line}` : ">")),
			].join("\n");
			const nextText = `${fileText.slice(0, section.end).trimEnd()}${result}\n${fileText.slice(section.end).replace(/^\s*/, "")}`;
			fs.writeFileSync(quiz.file, nextText, "utf-8");
			updateQuizStats(quiz.file, correct);
			if (quiz.phase === "lesson") updateTopicStats(quiz.subjectDir, quiz.slug, correct);
		});

		pendingQuizzes.delete(quiz.assessmentId);
		persistQuiz(quiz, true);
		sendAssessmentEvent(
			[
				`The learner submitted an Obsidian multiple-choice assessment for ${quiz.slug}.`,
				`Result: ${correct ? "correct" : "incorrect"}.`,
				`Selected: ${selectedIndex}. ${quiz.options[selectedIndex - 1] || ""}`,
				`Correct: ${quiz.correctIndex}. ${quiz.options[quiz.correctIndex - 1] || ""}`,
				`Explanation: ${quiz.explanation}`,
				correct
					? "Treat this as the node's quiz-check evidence and continue the learning lifecycle."
					: "Treat this as a quiz miss: diagnose the gap, reteach or inspect prerequisites, record a real misconception only if evidence supports one, then reassess before advancing.",
			].join("\n"),
			{ assessmentId: quiz.assessmentId, topic: quiz.slug, phase: quiz.phase, correct, selectedIndex },
		);
	}

	async function submitCodeFromFile(code: PendingCodeSubmission, submission: string): Promise<void> {
		if (code.awaitingGrade || submission === code.lastSubmission) return;
		code.awaitingGrade = true;
		code.lastSubmission = submission;
		persistCode(code, false);
		sendAssessmentEvent(
			[
				`The learner submitted coding exercise ${code.exerciseId} from Obsidian.`,
				`Topic: ${code.slug}`,
				`Language: ${code.language}`,
				`Exercise: ${code.prompt}`,
				"Acceptance criteria:",
				...code.criteria.map((criterion, index) => `${index + 1}. ${criterion}`),
				"Exact submission:",
				fence(code.language, submission),
				"Evaluate every criterion. When feasible and safe, run/compile/test the code. Then call lesson_code_result with this exact submission, the verified pass/fail result, concise feedback, and actual test evidence if executed.",
			].join("\n"),
			{ exerciseId: code.exerciseId, topic: code.slug, phase: code.phase, submission },
		);
	}

	async function scanFile(file: string): Promise<void> {
		if (!fs.existsSync(file)) return;
		let text = fs.readFileSync(file, "utf-8");

		for (const quiz of [...pendingQuizzes.values()].filter((item) => item.file === file)) {
			const marker = `<!-- obsidian-quiz-id:${quiz.assessmentId} -->`;
			const section = sectionForMarker(text, marker);
			if (!section) continue;
			const submitChecked = /^- \[[xX]\]\s+Submit answer\s*$/m.test(section.text);
			const checked = [...section.text.matchAll(/^- \[[xX]\]\s+(\d+)\./gm)].map((match) => Number(match[1]));
			if (submitChecked && checked.length === 1) {
				await gradeCheckedQuiz(quiz, checked[0]);
				if (fs.existsSync(file)) text = fs.readFileSync(file, "utf-8");
			}
		}

		for (const code of [...pendingCode.values()].filter((item) => item.file === file)) {
			if (code.awaitingGrade) continue;
			const marker = `<!-- obsidian-code-id:${code.exerciseId} -->`;
			const endMarker = `<!-- /obsidian-code:${code.exerciseId} -->`;
			const section = sectionForMarker(text, marker, endMarker);
			if (!section || !/^- \[[xX]\]\s+Submit\s*$/m.test(section.text)) continue;
			const fenceMatch = /^(`{3,})[^\n]*\n([\s\S]*?)\n\1/m.exec(section.text);
			const submission = fenceMatch?.[2]?.trim() || "";
			if (!submission) continue;

			await withLock(() => {
				const latest = fs.readFileSync(file, "utf-8");
				const latestSection = sectionForMarker(latest, marker, endMarker);
				if (!latestSection) return;
				const reset = latestSection.text.replace(/^- \[[xX]\]\s+Submit\s*$/m, "- [ ] Submit");
				fs.writeFileSync(file, `${latest.slice(0, latestSection.start)}${reset}${latest.slice(latestSection.end)}`, "utf-8");
			});
			await submitCodeFromFile(code, submission);
			if (fs.existsSync(file)) text = fs.readFileSync(file, "utf-8");
		}
	}

	function watchFile(file: string): void {
		if (!file || watchedFiles.has(file)) return;
		watchedFiles.add(file);
		fs.watchFile(file, { interval: 500 }, () => {
			void scanFile(file);
		});
		setTimeout(() => void scanFile(file), 50);
	}

	pi.on("session_start", async (_event, ctx: any) => {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === "obsidian-quiz-assessment") {
				const data = entry.data as PendingObsidianQuiz & { completed?: boolean };
				if (!data?.assessmentId) continue;
				if (data.completed) pendingQuizzes.delete(data.assessmentId);
				else pendingQuizzes.set(data.assessmentId, data);
			}
			if (entry.customType === "obsidian-code-submit") {
				const data = entry.data as PendingCodeSubmission & { completed?: boolean };
				if (!data?.exerciseId) continue;
				if (data.completed) pendingCode.delete(data.exerciseId);
				else pendingCode.set(data.exerciseId, data);
			}
		}
		for (const file of new Set([
			...[...pendingQuizzes.values()].map((item) => item.file),
			...[...pendingCode.values()].map((item) => item.file),
		])) watchFile(file);
	});

	pi.on("session_shutdown", async () => {
		for (const file of watchedFiles) fs.unwatchFile(file);
		watchedFiles.clear();
	});

	pi.on("before_agent_start", async (event, ctx: any) => {
		const state = getLessonLogState(ctx);
		if (!activeLearning(state)) return;
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nOBSIDIAN-FIRST LEARNING MODE:\n" +
				"- Obsidian is the learner-facing lesson and assessment interface; keep terminal prose brief and navigational.\n" +
				"- For each concept, call lesson_note and write the durable node with lesson_write BEFORE creating any lesson-phase assessment. Do not make the learner read the substantive lesson only in the terminal.\n" +
				"- After the node is written, create either lesson_obsidian_quiz or lesson_code_exercise as appropriate. Do not use the built-in terminal quiz while this learning track is active.\n" +
				"- Do not ask the learner to type quiz answers or code back into the terminal. They submit from Obsidian; file submission triggers the next Pi turn automatically.\n" +
				"- A passed coding exercise or Obsidian quiz counts as the teach skill's quiz-check. Use both only when they test different necessary dimensions.",
		};
	});

	pi.on("tool_call", async (event: any, ctx: any) => {
		const state = getLessonLogState(ctx);
		if (event.toolName === "quiz" && activeLearning(state)) {
			return {
				block: true,
				reason:
					"Obsidian-first learning is active. Use lesson_obsidian_quiz for conceptual assessment or lesson_code_exercise for implementation assessment so the learner can submit from Obsidian.",
			};
		}

		if (event.toolName === "lesson_code_exercise") {
			if (activeLearning(state) && state.quizPhase === "lesson" && !topicReadyForAssessment(state)) {
				return {
					block: true,
					reason:
						"Write the current node to Obsidian first with lesson_write (Core Idea plus substantive explanation/mental model/how-it-works/example) before creating its coding assessment.",
				};
			}
			const input = event.input || {};
			capturedCodeCalls.set(String(event.toolCallId || ""), {
				prompt: String(input.prompt || ""),
				language: input.language ? String(input.language) : undefined,
				starterCode: input.starterCode ? String(input.starterCode) : undefined,
				criteria: Array.isArray(input.criteria) ? input.criteria.map(String) : [],
			});
		}
	});

	pi.on("tool_result", async (event: any, ctx: any) => {
		if (event.toolName === "lesson_code_exercise") {
			const details = event.details || {};
			if (details.status !== "awaiting-submission" || !details.exerciseId || !details.file) return;
			const callId = String(event.toolCallId || "");
			const captured = capturedCodeCalls.get(callId) || { prompt: "", criteria: [] };
			capturedCodeCalls.delete(callId);
			const state = getLessonLogState(ctx);
			const pending: PendingCodeSubmission = {
				exerciseId: String(details.exerciseId),
				file: String(details.file),
				subjectDir: String(state?.subjectDir || path.dirname(path.dirname(String(details.file)))),
				slug: slugify(String(details.topic || state?.quizSlug || state?.lessonSlug || "")),
				phase: details.phase === "diagnostic" ? "diagnostic" : "lesson",
				language: String(details.language || captured.language || "text"),
				criteria: Array.isArray(details.criteria) ? details.criteria.map(String) : captured.criteria,
				prompt: captured.prompt,
				awaitingGrade: false,
			};
			pendingCode.set(pending.exerciseId, pending);
			persistCode(pending, false);
			const starter = captured.starterCode?.trim() || "";
			appendToBody(
				pending.file,
				[
					"### Your Submission",
					`<!-- obsidian-code-id:${pending.exerciseId} -->`,
					"Edit the fenced block below, then check **Submit**. Pi will detect the saved file automatically.",
					"",
					fence(pending.language, starter),
					"",
					"- [ ] Submit",
					`<!-- /obsidian-code:${pending.exerciseId} -->`,
				].join("\n"),
			);
			watchFile(pending.file);
		}

		if (event.toolName === "lesson_code_result") {
			const details = event.details || {};
			const exerciseId = String(details.exerciseId || "");
			if (!exerciseId) return;
			const pending = pendingCode.get(exerciseId);
			if (!pending) return;
			const correct = details.status === "correct";
			if (pending.phase === "lesson") setTopicLastAssessment(pending.subjectDir, pending.slug, correct);
			pending.awaitingGrade = false;
			if (correct) pendingCode.delete(exerciseId);
			else pendingCode.set(exerciseId, pending);
			persistCode(pending, correct);
		}
	});

	pi.registerTool({
		name: "lesson_obsidian_quiz",
		label: "Obsidian lesson quiz",
		description:
			"Write a single-answer conceptual quiz into the active diagnostic/lesson quiz file so the learner answers by clicking checkboxes in Obsidian. The file watcher grades the answer, records evidence, and triggers the next Pi turn automatically.",
		promptSnippet:
			"During an active lesson-log track, satisfy conceptual quiz-checks with lesson_obsidian_quiz instead of the terminal quiz. For lesson-phase checks, finish writing the current node to Obsidian first. The learner answers in Obsidian; do not restate the question in the terminal.",
		promptGuidelines: [
			"Use this for objectively gradable conceptual knowledge, reasoning, distinctions, or prediction.",
			"Use lesson_code_exercise instead when full understanding requires writing/debugging/configuring/querying code.",
			"For lesson-phase assessment, the durable node must already exist in Obsidian before this tool is called.",
			"Exactly one option must be defensibly correct. Keep distractors plausible and parallel.",
			"Do not reveal the correct answer in the question or options. The explanation is written only after submission.",
			"After calling this tool, keep terminal output minimal; the learner will read and answer in Obsidian.",
		],
		parameters: ObsidianQuizParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: any) {
			const state = getLessonLogState(ctx);
			if (!activeLearning(state) || !state.quizFile || !state.quizSlug || !state.quizPhase || !state.subjectDir) {
				return {
					content: [{ type: "text", text: "No active lesson assessment target. Start with lesson_start or activate a concept with lesson_note." }],
					details: { status: "no-assessment" },
				};
			}
			if (state.quizPhase === "lesson" && !topicReadyForAssessment(state)) {
				return {
					content: [{ type: "text", text: "Current node is not written enough for assessment yet. Write Core Idea plus at least one substantive explanatory section with lesson_write first." }],
					details: { status: "lesson-not-written" },
				};
			}
			if (params.correctIndex < 1 || params.correctIndex > params.options.length) {
				return {
					content: [{ type: "text", text: "correctIndex must point to one of the supplied options." }],
					details: { status: "invalid-answer" },
				};
			}

			const file = state.quizFile;
			const slug = slugify(state.quizSlug);
			const number = nextQuizNumber(file);
			const assessmentId = `${slug}-quiz-${number}`;
			const quiz: PendingObsidianQuiz = {
				assessmentId,
				file,
				subjectDir: state.subjectDir,
				slug,
				phase: state.quizPhase,
				number,
				question: params.question.trim(),
				options: params.options.map((option: string) => option.trim()),
				correctIndex: params.correctIndex,
				explanation: params.explanation.trim(),
			};

			const block = [
				`## Quiz ${number}`,
				`<!-- obsidian-quiz-id:${assessmentId} -->`,
				"",
				"> [!question] Question",
				...quiz.question.split("\n").map((line) => (line ? `> ${line}` : ">")),
				"",
				"### Answer in Obsidian",
				"Check exactly one answer, then check **Submit answer**. Obsidian saves the note and Pi detects it automatically.",
				"",
				...quiz.options.map((option, index) => `- [ ] ${index + 1}. ${option}`),
				"",
				"- [ ] Submit answer",
			].join("\n");
			appendToBody(file, block);
			pendingQuizzes.set(assessmentId, quiz);
			persistQuiz(quiz, false);
			watchFile(file);

			return {
				content: [{ type: "text", text: `Assessment written to Obsidian: ${file}. Do not restate the question in the terminal; wait for the file submission.` }],
				details: { status: "awaiting-obsidian", assessmentId, file, topic: slug, phase: state.quizPhase },
			};
		},
	});
}
