/** Pure project validation/readiness/rendering; learner implementation is never written here. */
export type ProjectRequirement = {
	id: string;
	behavior: string;
	concepts: string[];
	criteria: string[];
	edgeCases: string[];
};

export type ProjectSpec = {
	title: string;
	brief: string;
	estimatedHours: number;
	priorKnowledge: { topic: string; title: string; evidence: string }[];
	tools: { name: string; concept: string }[];
	requirements: ProjectRequirement[];
	designQuestions: string[];
	definitionOfDone: string[];
	nonGoals: string[];
};

export type RequirementReview = {
	requirementId: string;
	passed: boolean;
	evidence: string;
};

export type ProjectReview = {
	work: string[];
	requirements: RequirementReview[];
	designEvidence: string;
	doneEvidence: string;
	feedback: string;
};

export type ProjectState = {
	spec: ProjectSpec;
	review?: ProjectReview;
};

type Step = { topic: string; title: string; state: string };
type Topic = { status: string; misconceptions?: { resolved: boolean }[]; assessments?: { lastCorrect?: boolean | null } };
export type ProjectContext = { steps: Step[]; topics: Record<string, Topic> };

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const slug = (value: unknown): value is string => text(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(text);

/** Structural scope gate. Pi must also audit the meaning of prose and hidden prerequisites. */
export function validateProject(spec: ProjectSpec, steps: Step[]): string[] {
	const errors: string[] = [];
	if (!text(spec?.title) || !text(spec?.brief)) errors.push("Project title and brief are required.");
	if (!Number.isFinite(spec?.estimatedHours) || spec.estimatedHours < 1 || spec.estimatedHours > 8) errors.push("Keep the project within 1–8 focused hours; reduce scope instead of adding lessons.");
	const planned = new Set(steps.map(step => step.topic));
	if (!steps.length || planned.size !== steps.length || steps.some(step => !slug(step.topic))) errors.push("Plan concepts must have unique, valid slugs.");
	const known = new Set<string>();
	if (!Array.isArray(spec?.priorKnowledge) || !Array.isArray(spec?.tools)) errors.push("Declare priorKnowledge and tools explicitly (empty arrays when none).");
	for (const item of spec?.priorKnowledge || []) {
		if (!slug(item.topic) || !text(item.title) || !text(item.evidence) || known.has(item.topic)) errors.push("Prior knowledge needs a unique concept, readable title, and diagnostic/learner evidence.");
		known.add(item.topic);
	}
	const allowed = new Set([...planned, ...known]);
	const covered = new Set<string>();
	const ids = new Set<string>();
	if (!Array.isArray(spec?.requirements) || spec.requirements.length < 1 || spec.requirements.length > 6) errors.push("Use 1–6 behavioral requirements.");
	for (const requirement of spec?.requirements || []) {
		if (!slug(requirement.id) || ids.has(requirement.id)) errors.push("Requirement IDs must be unique slugs.");
		ids.add(requirement.id);
		if (!text(requirement.behavior) || !texts(requirement.criteria) || !texts(requirement.edgeCases)) errors.push(`${requirement.id}: behavior, objective acceptance criteria, and edge cases are required.`);
		if (!texts(requirement.concepts)) errors.push(`${requirement.id}: map required concepts to the plan or evidenced prior knowledge.`);
		for (const concept of requirement.concepts || []) {
			if (!allowed.has(concept)) errors.push(`${requirement.id}: out-of-scope concept '${concept}'.`);
			covered.add(concept);
		}
	}
	for (const step of steps) {
		if (!covered.has(step.topic)) errors.push(`Project does not exercise plan concept '${step.topic}'.`);
		if (step.state === "skipped" && !known.has(step.topic)) errors.push(`Skipped concept '${step.topic}' needs prior-knowledge evidence.`);
	}
	for (const tool of spec?.tools || []) {
		if (!text(tool.name) || !allowed.has(tool.concept) || !covered.has(tool.concept)) errors.push(`Tool '${tool.name}' must map to a required taught/prior-known concept.`);
	}
	if (!texts(spec?.designQuestions) || spec.designQuestions.length < 2) errors.push("Leave at least two meaningful design decisions to the learner.");
	if (!texts(spec?.definitionOfDone) || !texts(spec?.nonGoals)) errors.push("Define objective completion conditions and explicit scope exclusions.");
	return errors;
}

export function missingConcepts(requirement: ProjectRequirement, spec: ProjectSpec, context: ProjectContext): string[] {
	const known = new Set(spec.priorKnowledge.map(item => item.topic));
	return requirement.concepts.filter(concept => {
		const topic = context.topics[concept];
		// New contradictory evidence takes precedence over earlier diagnostic credit.
		if (topic?.misconceptions?.some(item => !item.resolved) || topic?.status === "blocked" || topic?.assessments?.lastCorrect === false) return true;
		return topic?.status !== "complete" && !known.has(concept);
	});
}

export function validateReview(review: ProjectReview, project: ProjectState, context: ProjectContext): string[] {
	const errors: string[] = [];
	if (!texts(review.work)) errors.push("Identify the learner files or submission actually inspected.");
	if (!text(review.feedback)) errors.push("Evidence-based feedback is required.");
	const ids = new Set<string>();
	for (const item of review.requirements) {
		const requirement = project.spec.requirements.find(req => req.id === item.requirementId);
		if (!requirement || ids.has(item.requirementId)) errors.push(`Unknown or duplicate requirement '${item.requirementId}'.`);
		ids.add(item.requirementId);
		if (!text(item.evidence)) errors.push(`${item.requirementId}: record observed acceptance/edge-case evidence, including failures.`);
		if (item.passed && requirement && missingConcepts(requirement, project.spec, context).length) errors.push(`${item.requirementId}: prerequisite learning is still pending.`);
	}
	const complete = project.spec.requirements.every(req => review.requirements.some(item => item.requirementId === req.id && item.passed));
	if (complete && (!text(review.designEvidence) || !text(review.doneEvidence))) errors.push("Final review needs the learner's design reasoning and evidence for every definition-of-done condition.");
	return errors;
}

export function projectStatus(project: ProjectState, context: ProjectContext): string {
	if (!project.review) return "Not started";
	if (project.review.requirements.some(item => !item.passed)) return "Needs revision";
	if (project.spec.requirements.every(req => project.review!.requirements.some(item => item.requirementId === req.id && item.passed) && !missingConcepts(req, project.spec, context).length)
		&& text(project.review.designEvidence) && text(project.review.doneEvidence)) return "Complete";
	return "In progress";
}

export function renderProject(project: ProjectState, context: ProjectContext, track: string): string {
	const spec = project.spec;
	const labels = new Map([...context.steps, ...spec.priorKnowledge].map(item => [item.topic, item.title]));
	const list = (values: string[]) => values.map(value => `- ${value}`).join("\n");
	const parts = [
		`# ${spec.title}`, spec.brief,
		`[Back to learning plan](${track}.md)`,
		`Estimated effort: ${spec.estimatedHours} focused hours. Start alongside the course or leave it for later.`,
		"The full specification is visible now. Readiness tells you which requirements your current knowledge supports; it is not an implementation recipe.",
		"## Requirements",
	];
	for (const req of spec.requirements) {
		const missing = missingConcepts(req, spec, context);
		const result = project.review?.requirements.find(item => item.requirementId === req.id);
		const readiness = missing.length ? `Requires later lessons: ${missing.map(id => labels.get(id) || id).join(", ")}.` : "Available now.";
		parts.push(`### ${req.behavior}`, readiness,
			`Concepts: ${req.concepts.map(id => labels.get(id) || id).join(", ")}.`,
			"Acceptance criteria:\n\n" + list(req.criteria), "Edge cases:\n\n" + list(req.edgeCases));
		if (result) parts.push(`Review: ${result.passed ? "Passed" : "Needs revision"}. ${result.evidence}`);
	}
	parts.push("## Design decisions", list(spec.designQuestions), "## Definition of done", list(spec.definitionOfDone), "## Out of scope", list(spec.nonGoals));
	if (spec.tools.length) parts.push("## Tools in scope", list(spec.tools.map(tool => `${tool.name} — ${labels.get(tool.concept) || tool.concept}`)));
	parts.push("## Working on the project", "Keep your implementation in your own project files. Before coding, explain your representation/schema, pseudocode, and key tradeoffs. Ask Pi to review a requirement when you have an attempt; share the files and your reasoning. Hints start with questions, not a solution.");
	if (project.review) parts.push("## Review", project.review.feedback);
	return parts.join("\n\n") + "\n";
}
