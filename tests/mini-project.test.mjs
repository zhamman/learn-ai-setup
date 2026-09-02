import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Value } from "@sinclair/typebox/value";
import lessonLog from "../extensions/lesson-log.ts";
import obsidianAssessment from "../extensions/obsidian-assessment.ts";
import { validateProject, missingConcepts, projectStatus } from "../extensions/lib/mini-project.ts";

const steps = [
  { topic: "collections", title: "Collections", state: "current" },
  { topic: "functions", title: "Functions", state: "next" },
  { topic: "file-io", title: "File I/O", state: "upcoming" },
];
const spec = () => ({
  title: "Expense analyzer", brief: "Summarize a small collection of expenses and preserve it between runs.", estimatedHours: 3,
  priorKnowledge: [], tools: [],
  requirements: [
    { id: "summarize", behavior: "Summarize expenses by category", concepts: ["collections", "functions"], criteria: ["Produce accurate category totals from the supplied expenses."], edgeCases: ["An empty collection produces no category totals."] },
    { id: "persist", behavior: "Preserve expenses between runs", concepts: ["collections", "file-io"], criteria: ["Loading saved expenses restores the same values."], edgeCases: ["An empty saved collection loads successfully."] },
  ],
  designQuestions: ["How will you represent each expense?", "Which responsibilities belong together, and why?"],
  definitionOfDone: ["Both requirements pass independently and together after restarting."],
  nonGoals: ["No UI, database, authentication, or network calls."],
});

async function harness(t, { legacy = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-project-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tools = new Map(), commands = new Map(), events = new Map(), entries = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, callback) { events.set(name, [...(events.get(name) || []), callback]); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
    sendMessage() {},
  };
  lessonLog(pi);
  obsidianAssessment(pi);
  const ctx = { cwd: root, ui: { notify() {} }, sessionManager: { getEntries: () => entries } };
  const call = async (name, params) => {
    const tool = tools.get(name);
    assert.ok(Value.Check(tool.parameters, params), JSON.stringify([...Value.Errors(tool.parameters, params)]));
    return tool.execute("test", params, undefined, undefined, ctx);
  };
  await commands.get("learn").handler("python", ctx);
  await call("lesson_start", { topic: "fundamentals" });
  const statePath = path.join(root, "python/.learning/state.json");
  const readState = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
  const writeState = state => fs.writeFileSync(statePath, JSON.stringify(state));
  if (legacy) writeState({ ...readState(), topics: { old: { status: "complete", title: "Old evidence" } }, plan: { steps, currentPosition: "collections", next: "functions" } });
  const plan = { topic: "fundamentals", goal: "Apply basic Python", startingPoint: "Diagnostic identifies missing integration skills", dependencyMap: "Collections → Functions → File I/O", steps: structuredClone(steps), currentPosition: "collections", next: "functions" };
  const note = () => fs.readFileSync(path.join(root, "python/plan/fundamentals-project.md"), "utf8");
  return { root, pi, ctx, events, call, plan, readState, writeState, note };
}

test("scope validates full coverage, explicit prior knowledge, tools and small size", () => {
  assert.deepEqual(validateProject(spec(), steps), []);
  for (const change of [
    p => p.requirements[0].concepts.push("redis"),
    p => p.tools.push({ name: "Redis", concept: "redis" }),
    p => p.requirements.pop(),
    p => { p.estimatedHours = 40; },
    p => { p.designQuestions = []; },
    p => { p.requirements[0].edgeCases = []; },
    p => { p.requirements[1].id = "summarize"; },
  ]) {
    const project = spec(); change(project);
    assert.ok(validateProject(project, steps).length);
  }
  const project = spec();
  project.priorKnowledge.push({ topic: "functions", title: "Functions", evidence: "Diagnostic: correctly decomposed and implemented two functions." });
  const skipped = steps.map(s => ({ ...s, state: s.topic === "functions" ? "skipped" : s.state }));
  assert.deepEqual(validateProject(project, skipped), []);
  project.priorKnowledge[0].evidence = " ";
  assert.ok(validateProject(project, skipped).length);
});

test("new plans require a project; invalid projects write no partial plan or project", async t => {
  const h = await harness(t);
  assert.equal((await h.call("lesson_plan", h.plan)).details.status, "project-required");
  const invalid = spec(); invalid.requirements[1].concepts.push("fastapi");
  assert.equal((await h.call("lesson_plan", { ...h.plan, miniProject: invalid })).details.status, "project-invalid");
  assert.equal(fs.existsSync(path.join(h.root, "python/plan/fundamentals.md")), false);
  assert.deepEqual(h.readState().projects, undefined);
  const result = await h.call("lesson_plan", { ...h.plan, miniProject: spec() });
  assert.equal(result.details.status, "written");
  assert.ok(fs.existsSync(result.details.projectFile));
  assert.match(fs.readFileSync(result.details.file, "utf8"), /\(fundamentals-project\.md\)/);
  assert.match(h.note(), /Requires later lessons: Collections, Functions/);
  assert.match(h.note(), /Preserve expenses between runs/);
});

test("legacy plan backfill and routine updates preserve existing evidence and learner code", async t => {
  const h = await harness(t, { legacy: true });
  await h.call("lesson_plan", { ...h.plan, miniProject: spec() });
  assert.equal(h.readState().topics.old.status, "complete");
  const codePath = path.join(h.root, "expense.py");
  fs.writeFileSync(codePath, "# learner's unfinished attempt\n");
  assert.equal((await h.call("lesson_plan", { ...h.plan, currentPosition: "functions" })).details.status, "written");
  assert.deepEqual(h.readState().projects.fundamentals.spec, spec());
  assert.equal(fs.readFileSync(codePath, "utf8"), "# learner's unfinished attempt\n");
});

test("readiness uses mastery, never roadmap labels, and revokes contradicted prior credit", () => {
  const project = spec();
  const context = { steps: steps.map(s => ({ ...s, state: "done" })), topics: {} };
  assert.deepEqual(missingConcepts(project.requirements[0], project, context), ["collections", "functions"]);
  context.topics.collections = { status: "complete" };
  project.priorKnowledge = [{ topic: "functions", title: "Functions", evidence: "Passed diagnostic implementation." }];
  assert.deepEqual(missingConcepts(project.requirements[0], project, context), []);
  context.topics.functions = { status: "learning", assessments: { lastCorrect: false } };
  assert.deepEqual(missingConcepts(project.requirements[0], project, context), ["functions"]);
});

test("lesson completion updates project readiness; assessment regression revokes it", async t => {
  const h = await harness(t);
  await h.call("lesson_plan", { ...h.plan, miniProject: spec() });
  for (const topic of ["collections", "functions"]) {
    await h.call("lesson_note", { topic });
    const prose = "Values can be grouped and processed to produce a result. ".repeat(14);
    await h.call("lesson_write", { heading: "Core idea", content: prose });
    await h.call("lesson_write", { heading: "Example", content: "Consider how empty input changes the expected result." });
    const exercise = await h.call("lesson_code_exercise", { prompt: "Implement the taught operation.", criteria: ["Expected output for supplied inputs."] });
    await h.call("lesson_code_result", { exerciseId: exercise.details.exerciseId, submission: "learner test fixture", correct: true, feedback: "Fixture evidence accepted." });
    const completed = await h.call("lesson_progress", { status: "complete" });
    assert.equal(completed.details.status, "complete", JSON.stringify(completed.details));
  }
  assert.match(h.note(), /Summarize expenses by category\n\nAvailable now/);
  assert.match(h.note(), /Requires later lessons: File I\/O/);
  const lessonPath = path.join(h.root, "python/topic/functions.md");
  const lesson = fs.readFileSync(lessonPath, "utf8");
  fs.appendFileSync(lessonPath, "\n## Empty section\n\n");
  assert.equal((await h.call("lesson_quality", {})).details.ready, false);
  fs.writeFileSync(lessonPath, lesson);
  const exercise = await h.call("lesson_code_exercise", { prompt: "Check transfer to a new case.", criteria: ["Handle empty input."] });
  await h.call("lesson_code_result", { exerciseId: exercise.details.exerciseId, submission: "incorrect fixture", correct: false, feedback: "Empty input fails." });
  assert.match(h.note(), /Requires later lessons: Functions/);
});

test("partial review merges, final review needs evidence, revisions cannot silently erase it", async t => {
  const h = await harness(t);
  await h.call("lesson_plan", { ...h.plan, miniProject: spec() });
  const review = { work: ["expense.py"], requirements: [{ requirementId: "summarize", passed: true, evidence: "Inspected totals and empty-input cases." }], designEvidence: "", doneEvidence: "", feedback: "Continue with persistence." };
  assert.equal((await h.call("lesson_project_review", review)).details.status, "review-blocked");
  const state = h.readState();
  for (const step of steps) state.topics[step.topic] = { status: "complete" };
  h.writeState(state);
  assert.equal((await h.call("lesson_project_review", review)).details.status, "In progress");
  await h.call("lesson_plan", h.plan);
  assert.equal(h.readState().projects.fundamentals.review.requirements.length, 1);
  const last = { ...review, requirements: [{ requirementId: "persist", passed: true, evidence: "Observed restore and empty-file round trip." }] };
  assert.equal((await h.call("lesson_project_review", last)).details.status, "review-blocked");
  assert.equal((await h.call("lesson_project_review", { ...last, designEvidence: "Learner justified representation and separation of responsibilities.", doneEvidence: "Both behaviors verified together after restart." })).details.status, "Complete");
  const changed = spec(); changed.brief = "Analyze daily expenses.";
  assert.equal((await h.call("lesson_plan", { ...h.plan, miniProject: changed })).details.status, "project-revision-required");
  assert.equal((await h.call("lesson_plan", { ...h.plan, miniProject: changed, reviseProject: true })).details.status, "written");
  assert.equal(h.readState().projects.fundamentals.review, undefined);
});

test("failed reviews, unknown IDs and partial revisions do not award completion", async t => {
  const h = await harness(t);
  await h.call("lesson_plan", { ...h.plan, miniProject: spec() });
  const review = { work: ["expense.py"], requirements: [{ requirementId: "summarize", passed: false, evidence: "Empty collection crashes." }], designEvidence: "", doneEvidence: "", feedback: "Explain empty input behavior before revising." };
  assert.equal((await h.call("lesson_project_review", review)).details.status, "Needs revision");
  assert.equal((await h.call("lesson_project_review", { ...review, requirements: [{ ...review.requirements[0], requirementId: "unknown" }] })).details.status, "review-blocked");
  assert.equal(projectStatus(h.readState().projects.fundamentals, { steps, topics: {} }), "Needs revision");
});

test("resume keeps project; adaptive scope cannot drop mappings; finishing leaves optional project available", async t => {
  const h = await harness(t);
  await h.call("lesson_plan", { ...h.plan, miniProject: spec() });
  const newTools = new Map();
  lessonLog({ ...h.pi, registerTool: tool => newTools.set(tool.name, tool) });
  for (const callback of (h.events.get("session_start") || []).slice(-1)) await callback({}, h.ctx);
  assert.equal((await newTools.get("lesson_plan").execute("resume", h.plan)).details.status, "written");
  assert.equal((await h.call("lesson_plan", { ...h.plan, steps: steps.slice(0, 2) })).details.status, "project-invalid");
  await h.call("lesson_plan", { ...h.plan, steps: steps.map(s => ({ ...s, state: "done" })) });
  const result = await h.call("lesson_finish", {});
  assert.equal(result.details.status, "finished");
  assert.equal(result.details.projectStatus, "Not started");
  assert.match(h.note(), /Expense analyzer/);
  await h.call("lesson_start", { topic: "another-track" });
  assert.equal((await h.call("lesson_project_review", { work: ["expense.py"], requirements: [{ requirementId: "summarize", passed: false, evidence: "Incomplete" }], designEvidence: "", doneEvidence: "", feedback: "Incomplete" })).details.status, "no-project");
});
