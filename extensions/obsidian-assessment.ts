/**
 * obsidian-assessment — bridge Pi learning tools to the Pi Learning Obsidian plugin.
 *
 * Visible quiz files contain only render blocks (`learning-quiz` / `learning-code`).
 * Correct answers, submissions, results, and mastery statistics live under
 * <subject>/.learning/ and are not shown as document metadata.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

type QuizPhase = "diagnostic" | "lesson";

type LessonLogSession = {
	subjectDir?: string | null;
	trackSlug?: string | null;
	trackTitle?: string | null;
	lifecycle?: string | null;
	lessonFile?: string | null;
	lessonSlug?: string | null;
	quizFile?: string | null;
	quizSlug?: string | null;
	quizPhase?: QuizPhase | null;
};

type HiddenState = {
	version?: number;
	subject?: string;
	track?: { lifecycle?: string; [key: string]: any };
	plan?: any;
	topics?: Record<string, any>;
	[key: string]: any;
};

type QuizAssessment = {
	id: string;
	type: "quiz";
	subjectDir: string;
	topic: string;
	phase: QuizPhase;
	file: string;
	label: string;
	question: string;
	options: string[];
	correctIndex: number;
	explanation: string;
	status: "pending" | "completed";
};

type CodeAssessment = {
	id: string;
	type: "code";
	subjectDir: string;
	topic: string;
	phase: QuizPhase;
	file: string;
	label: string;
	language: string;
	prompt: string;
	criteria: string[];
	starterCode: string;
	status: "pending" | "awaiting-grade" | "completed";
};

type Assessment = QuizAssessment | CodeAssessment;

const QuizParams = Type.Object({
	question: Type.String({ description: "Self-contained conceptual question." }),
	options: Type.Array(Type.String(), { minItems: 2, maxItems: 6, description: "Distinct answer options." }),
	correctIndex: Type.Integer({ minimum: 1, description: "1-based index of the one correct option." }),
	explanation: Type.String({ description: "Concise explanation shown after submission." }),
	label: Type.Optional(Type.String({ description: "Short UI label such as 'Check 1'." })),
});

const CodeParams = Type.Object({
	prompt: Type.String({ description: "Self-contained implementation/debugging/querying task." }),
	language: Type.Optional(Type.String({ description: "Language id such as python, typescript, sql, bash." })),
	starterCode: Type.Optional(Type.String({ description: "Optional starter code without the solution." })),
	criteria: Type.Array(Type.String(), { minItems: 1, description: "Objective grading criteria." }),
	label: Type.Optional(Type.String({ description: "Short UI label such as 'Coding exercise'." })),
});

const CodeResultParams = Type.Object({
	exerciseId: Type.String({ description: "Assessment id returned by lesson_code_exercise." }),
	submission: Type.String({ description: "Exact learner submission that was evaluated." }),
	correct: Type.Boolean({ description: "True only if all acceptance criteria are satisfied." }),
	feedback: Type.String({ description: "Concise evidence-based feedback." }),
	testEvidence: Type.Optional(Type.String({ description: "Only actual compiler/test/runtime evidence, if executed." })),
});

function slugify(input: string): string {
	return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function ensureDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

function learningDir(subjectDir: string): string {
	return path.join(subjectDir, ".learning");
}

function assessmentDir(subjectDir: string): string {
	return path.join(learningDir(subjectDir), "assessments");
}

function submissionDir(subjectDir: string): string {
	return path.join(learningDir(subjectDir), "submissions");
}

function resultDir(subjectDir: string): string {
	return path.join(learningDir(subjectDir), "results");
}

function stateFile(subjectDir: string): string {
	return path.join(learningDir(subjectDir), "state.json");
}

function ensureLearningDirs(subjectDir: string): void {
	for (const dir of [learningDir(subjectDir), assessmentDir(subjectDir), submissionDir(subjectDir), resultDir(subjectDir)]) ensureDir(dir);
}

function readJson<T>(file: string): T | null {
	try {
		if (!fs.existsSync(file)) return null;
		return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
	} catch {
		return null;
	}
}

function writeJson(file: string, value: unknown): void {
	ensureDir(path.dirname(file));
	const temp = `${file}.tmp`;
	fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	fs.renameSync(temp, file);
}

function getLessonLogState(ctx: any): LessonLogSession | null {
	let last: LessonLogSession | null = null;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === "lesson-log") last = entry.data as LessonLogSession;
	}
	return last;
}

function activeLearning(state: LessonLogSession | null): boolean {
	return Boolean(state?.subjectDir && state?.trackSlug && state?.lifecycle !== "finished");
}

function noteReady(file: string | null | undefined): boolean {
	if (!file || !fs.existsSync(file)) return false;
	const text = fs.readFileSync(file, "utf-8");
	const headings = (text.match(/^##\s+.+$/gm) || []).length;
	const words = text.replace(/^#+\s+.*$/gm, " ").replace(/```[\s\S]*?```/g, " code ").trim().split(/\s+/).filter(Boolean).length;
	return headings >= 2 && words >= 120;
}

function appendRenderBlock(file: string, language: "learning-quiz" | "learning-code", payload: Record<string, unknown>): void {
	ensureDir(path.dirname(file));
	const current = fs.existsSync(file) ? fs.readFileSync(file, "utf-8").trimEnd() : "";
	const block = `~~~${language}\n${JSON.stringify(payload)}\n~~~`;
	const prefix = current ? `${current}\n\n` : "";
	fs.writeFileSync(file, `${prefix}${block}\n`, "utf-8");
}

function assessmentPath(subjectDir: string, id: string): string {
	return path.join(assessmentDir(subjectDir), `${id}.json`);
}

function resultPath(subjectDir: string, id: string): string {
	return path.join(resultDir(subjectDir), `${id}.json`);
}

function nextAssessmentId(subjectDir: string, topic: string, kind: "quiz" | "code"): string {
	ensureLearningDirs(subjectDir);
	const prefix = `${slugify(topic)}-${kind}-`;
	let max = 0;
	for (const name of fs.readdirSync(assessmentDir(subjectDir))) {
		const match = name.match(new RegExp(`^${prefix}(\\d+)\\.json$`));
		if (match) max = Math.max(max, Number(match[1]));
	}
	return `${prefix}${max + 1}`;
}

function defaultStats(): any {
	return { correct: 0, total: 0, lastCorrect: null, codeCorrect: 0, codeTotal: 0, lastCodeCorrect: null };
}

function updateMastery(subjectDir: string, topicSlug: string, correct: boolean, code: boolean): void {
	const file = stateFile(subjectDir);
	const state = readJson<HiddenState>(file) || { version: 2, topics: {} };
	state.topics = state.topics || {};
	const topic = state.topics[topicSlug] || {
		title: topicSlug,
		file: path.join(subjectDir, "topic", `${topicSlug}.md`),
		status: "learning",
		requiresCode: false,
		prerequisites: [],
		related: [],
		assessments: defaultStats(),
		misconceptions: [],
	};
	const stats = { ...defaultStats(), ...(topic.assessments || {}) };
	stats.total += 1;
	if (correct) stats.correct += 1;
	stats.lastCorrect = correct;
	if (code) {
		stats.codeTotal += 1;
		if (correct) stats.codeCorrect += 1;
		stats.lastCodeCorrect = correct;
	}
	topic.assessments = stats;
	if (!correct) topic.status = "learning";
	state.topics[topicSlug] = topic;
	writeJson(file, state);
}

function setAssessmentLifecycle(subjectDir: string): void {
	const file = stateFile(subjectDir);
	const state = readJson<HiddenState>(file);
	if (!state?.track) return;
	state.track.lifecycle = "assessment";
	writeJson(file, state);
}

export default function obsidianAssessment(pi: ExtensionAPI) {
	const subjects = new Set<string>();
	let pollTimer: NodeJS.Timeout | null = null;
	let processing = false;

	function sendAssessmentEvent(content: string, details: Record<string, unknown>): void {
		pi.sendMessage(
			{ customType: "obsidian-learning-submission", content, display: false, details },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	function registerSubject(subjectDir: string | null | undefined): void {
		if (!subjectDir) return;
		ensureLearningDirs(subjectDir);
		subjects.add(subjectDir);
	}

	async function processQuizSubmission(subjectDir: string, submission: any): Promise<void> {
		const id = String(submission.assessmentId || "");
		const assessment = readJson<QuizAssessment>(assessmentPath(subjectDir, id));
		if (!assessment || assessment.type !== "quiz" || assessment.status === "completed") return;
		const selectedIndex = Number(submission.selectedIndex);
		if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > assessment.options.length) return;
		const correct = selectedIndex === assessment.correctIndex;
		assessment.status = "completed";
		writeJson(assessmentPath(subjectDir, id), assessment);
		writeJson(resultPath(subjectDir, id), {
			assessmentId: id,
			type: "quiz",
			correct,
			selectedIndex,
			correctIndex: assessment.correctIndex,
			feedback: assessment.explanation,
			completedAt: new Date().toISOString(),
		});
		if (assessment.phase === "lesson") updateMastery(subjectDir, assessment.topic, correct, false);
		sendAssessmentEvent(
			[
				`The learner submitted the Obsidian conceptual assessment for ${assessment.topic}.`,
				`Result: ${correct ? "correct" : "incorrect"}.`,
				`Selected: ${selectedIndex}. ${assessment.options[selectedIndex - 1]}`,
				`Correct: ${assessment.correctIndex}. ${assessment.options[assessment.correctIndex - 1]}`,
				`Explanation: ${assessment.explanation}`,
				correct
					? "Treat this as valid quiz-check evidence and continue the learning lifecycle."
					: "Treat this as a miss: diagnose the gap, reteach or inspect prerequisites, record a misconception only if evidence supports one, and reassess before advancing.",
			].join("\n"),
			{ assessmentId: id, topic: assessment.topic, phase: assessment.phase, correct, selectedIndex },
		);
	}

	async function processCodeSubmission(subjectDir: string, submission: any): Promise<void> {
		const id = String(submission.assessmentId || "");
		const assessment = readJson<CodeAssessment>(assessmentPath(subjectDir, id));
		if (!assessment || assessment.type !== "code" || assessment.status === "completed") return;
		const code = String(submission.code || "");
		if (!code.trim()) return;
		assessment.status = "awaiting-grade";
		writeJson(assessmentPath(subjectDir, id), assessment);
		sendAssessmentEvent(
			[
				`The learner submitted coding exercise ${id} from Obsidian.`,
				`Topic: ${assessment.topic}`,
				`Language: ${assessment.language}`,
				`Task: ${assessment.prompt}`,
				"Acceptance criteria:",
				...assessment.criteria.map((criterion, index) => `${index + 1}. ${criterion}`),
				"Exact submission:",
				`~~~${assessment.language}`,
				code,
				"~~~",
				"Evaluate every criterion. When feasible and safe, actually run/compile/test it. Then call lesson_code_result with this exact submission and verified result.",
			].join("\n"),
			{ assessmentId: id, exerciseId: id, topic: assessment.topic, phase: assessment.phase, submission: code },
		);
	}

	async function scanSubmissions(): Promise<void> {
		if (processing) return;
		processing = true;
		try {
			for (const subjectDir of subjects) {
				const dir = submissionDir(subjectDir);
				if (!fs.existsSync(dir)) continue;
				for (const name of fs.readdirSync(dir).filter((value) => value.endsWith(".json")).sort()) {
					const file = path.join(dir, name);
					const submission = readJson<any>(file);
					if (!submission) continue;
					try {
						if (submission.type === "quiz") await processQuizSubmission(subjectDir, submission);
						else if (submission.type === "code") await processCodeSubmission(subjectDir, submission);
						fs.unlinkSync(file);
					} catch {
						// Leave the file in place so a transient failure can retry.
					}
				}
			}
		} finally {
			processing = false;
		}
	}

	pi.on("session_start", async (_event, ctx: any) => {
		registerSubject(getLessonLogState(ctx)?.subjectDir);
		if (!pollTimer) pollTimer = setInterval(() => { void scanSubmissions(); }, 500);
	});

	pi.on("session_shutdown", async () => {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = null;
		subjects.clear();
	});

	pi.on("before_agent_start", async (event, ctx: any) => {
		const state = getLessonLogState(ctx);
		registerSubject(state?.subjectDir);
		if (!activeLearning(state)) return;
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nOBSIDIAN LEARNING UI:\n" +
				"- Obsidian is the learner-facing lesson, plan, quiz, and coding interface. Keep terminal prose brief and navigational.\n" +
				"- For every lesson-phase concept, call lesson_note and write the substantive lesson with lesson_write BEFORE creating an assessment. The learner should read the lesson in Obsidian, not depend on terminal prose.\n" +
				"- Use lesson_obsidian_quiz for conceptual checks and lesson_code_exercise when implementation/debugging/querying code is necessary. Do not use the built-in terminal quiz during an active learning track.\n" +
				"- After creating an assessment, stop and wait. The Obsidian plugin submits it through .learning/submissions and automatically triggers the next Pi turn.\n" +
				"- A passed Obsidian quiz or coding exercise counts as the teach skill's quiz-check. Use both only when they test genuinely different required abilities.\n" +
				"- Machine state, scores, dates, misconceptions, and completion flags stay hidden under .learning; do not write them into visible notes.",
		};
	});

	pi.on("tool_call", async (event: any, ctx: any) => {
		const state = getLessonLogState(ctx);
		registerSubject(state?.subjectDir);
		if (event.toolName === "quiz" && activeLearning(state)) {
			return { block: true, reason: "Obsidian learning UI is active. Use lesson_obsidian_quiz or lesson_code_exercise instead of the terminal quiz." };
		}
		if (["lesson_obsidian_quiz", "lesson_code_exercise"].includes(event.toolName) && state?.quizPhase === "lesson" && !noteReady(state.lessonFile)) {
			return {
				block: true,
				reason: "Write the substantive lesson node to Obsidian first. The active topic note needs at least two useful sections and enough explanatory content before its assessment is created.",
			};
		}
	});

	pi.registerTool({
		name: "lesson_obsidian_quiz",
		label: "Obsidian quiz",
		description: "Create a sleek conceptual assessment rendered by the Pi Learning Obsidian plugin. Correct answers stay hidden under .learning; the learner selects one option and presses a real Submit answer button in Obsidian.",
		promptSnippet: "Use for conceptual quiz-checks. During lesson phase, write the lesson note first, then create this assessment and wait for the Obsidian submission.",
		parameters: QuizParams,
		async execute(_id, params, _signal, _onUpdate, ctx: any) {
			const session = getLessonLogState(ctx);
			if (!session?.subjectDir || !session.quizFile || !session.quizSlug || !session.quizPhase) {
				return { content: [{ type: "text", text: "No active learning assessment target." }], details: { status: "no-assessment" } };
			}
			registerSubject(session.subjectDir);
			if (params.correctIndex > params.options.length) {
				return { content: [{ type: "text", text: "correctIndex is outside the options array." }], details: { status: "invalid-answer" } };
			}
			const id = nextAssessmentId(session.subjectDir, session.quizSlug, "quiz");
			const assessment: QuizAssessment = {
				id,
				type: "quiz",
				subjectDir: session.subjectDir,
				topic: session.quizSlug,
				phase: session.quizPhase,
				file: session.quizFile,
				label: params.label?.trim() || (session.quizPhase === "diagnostic" ? "Diagnostic check" : "Check"),
				question: params.question.trim(),
				options: params.options.map((option: string) => option.trim()),
				correctIndex: params.correctIndex,
				explanation: params.explanation.trim(),
				status: "pending",
			};
			writeJson(assessmentPath(session.subjectDir, id), assessment);
			appendRenderBlock(session.quizFile, "learning-quiz", {
				id,
				label: assessment.label,
				topic: assessment.topic,
				question: assessment.question,
				options: assessment.options,
			});
			setAssessmentLifecycle(session.subjectDir);
			return {
				content: [{ type: "text", text: `Obsidian assessment ready: ${session.quizFile}. Wait for the learner to submit it in Obsidian.` }],
				details: { status: "awaiting-submission", assessmentId: id, file: session.quizFile, topic: assessment.topic, phase: assessment.phase },
			};
		},
	});

	pi.registerTool({
		name: "lesson_code_exercise",
		label: "Obsidian coding exercise",
		description: "Create a coding exercise rendered as an editable modern code surface in Obsidian. The learner presses Submit code; Pi receives the exact submission automatically for grading.",
		promptSnippet: "Use when implementation ability is required for full understanding. Write the lesson note first, then create the exercise and wait for submission.",
		parameters: CodeParams,
		async execute(_id, params, _signal, _onUpdate, ctx: any) {
			const session = getLessonLogState(ctx);
			if (!session?.subjectDir || !session.quizFile || !session.quizSlug || !session.quizPhase) {
				return { content: [{ type: "text", text: "No active learning assessment target." }], details: { status: "no-assessment" } };
			}
			registerSubject(session.subjectDir);
			const id = nextAssessmentId(session.subjectDir, session.quizSlug, "code");
			const assessment: CodeAssessment = {
				id,
				type: "code",
				subjectDir: session.subjectDir,
				topic: session.quizSlug,
				phase: session.quizPhase,
				file: session.quizFile,
				label: params.label?.trim() || "Coding exercise",
				language: params.language?.trim() || "text",
				prompt: params.prompt.trim(),
				criteria: params.criteria.map((criterion: string) => criterion.trim()).filter(Boolean),
				starterCode: params.starterCode || "",
				status: "pending",
			};
			writeJson(assessmentPath(session.subjectDir, id), assessment);
			appendRenderBlock(session.quizFile, "learning-code", {
				id,
				label: assessment.label,
				topic: assessment.topic,
				language: assessment.language,
				prompt: assessment.prompt,
				criteria: assessment.criteria,
				starterCode: assessment.starterCode,
			});
			setAssessmentLifecycle(session.subjectDir);
			return {
				content: [{ type: "text", text: `Coding exercise ready in Obsidian: ${session.quizFile}. Wait for the learner to submit code there.` }],
				details: { status: "awaiting-submission", exerciseId: id, assessmentId: id, file: session.quizFile, topic: assessment.topic, phase: assessment.phase, language: assessment.language, criteria: assessment.criteria },
			};
		},
	});

	pi.registerTool({
		name: "lesson_code_result",
		label: "coding result",
		description: "Record the verified result for a coding submission received from the Obsidian plugin. Writes hidden result/mastery state; the plugin displays feedback automatically.",
		promptSnippet: "After evaluating an Obsidian code submission, call this with the exact submission and verified result.",
		parameters: CodeResultParams,
		async execute(_id, params, _signal, _onUpdate, ctx: any) {
			const session = getLessonLogState(ctx);
			const subjectDir = session?.subjectDir;
			if (!subjectDir) return { content: [{ type: "text", text: "No active learning subject." }], details: { status: "no-subject" } };
			registerSubject(subjectDir);
			const assessment = readJson<CodeAssessment>(assessmentPath(subjectDir, params.exerciseId));
			if (!assessment || assessment.type !== "code") {
				return { content: [{ type: "text", text: `Unknown coding exercise: ${params.exerciseId}` }], details: { status: "unknown-exercise" } };
			}
			assessment.status = "completed";
			writeJson(assessmentPath(subjectDir, assessment.id), assessment);
			writeJson(resultPath(subjectDir, assessment.id), {
				assessmentId: assessment.id,
				type: "code",
				correct: params.correct,
				feedback: params.feedback.trim(),
				testEvidence: params.testEvidence?.trim() || null,
				submission: params.submission,
				completedAt: new Date().toISOString(),
			});
			if (assessment.phase === "lesson") updateMastery(subjectDir, assessment.topic, params.correct, true);
			return {
				content: [{ type: "text", text: params.correct ? `Coding exercise ${assessment.id} passed.` : `Coding exercise ${assessment.id} needs revision. The learner can submit a revised exercise after remediation.` }],
				details: { status: params.correct ? "correct" : "incorrect", exerciseId: assessment.id, assessmentId: assessment.id, topic: assessment.topic },
			};
		},
	});
}
