# Mini-projects

## Generate alongside the plan

Pass `miniProject` to the first `lesson_plan` call. Backfill it on the next plan update for an existing course without a project; preserve the existing lessons and assessment evidence. Do not rerun a diagnostic solely for this migration.

Choose one small challenge that exercises every concept in the plan and combines them into a coherent outcome. Target 2–4 focused hours after learning the material; the structural maximum is eight hours and six requirements. Reduce incidental features before expanding the curriculum. A narrow single-topic lesson may have a smaller project that combines that concept's taught operations. Avoid defaulting to CRUD: a simulator, analyzer, debugging task, query workload, or architecture exercise may test the actual subject better.

The specification describes behavior and objective success, not an implementation tutorial. Keep algorithms, data structures, class boundaries, function signatures, and solution code open unless a taught interface is itself a requirement. Leave at least two real design decisions. Do not pad the challenge with unrelated setup, deployment, authentication, or UI work.

The `miniProject` object contains:

| Field | Content |
| --- | --- |
| `title`, `brief` | Human-readable name and problem/outcome |
| `estimatedHours` | Number from 1–8, for implementation after learning |
| `priorKnowledge` | `{topic, title, evidence}` entries; stable concept slug and specific diagnostic or established learner evidence; `[]` if none |
| `tools` | Every required framework/library/tool as `{name, concept}`; `[]` if none |
| `requirements` | 1–6 entries, each with stable `id`, `behavior`, `concepts`, `criteria`, and `edgeCases` |
| `designQuestions` | At least two meaningful questions, without prescribing their answers |
| `definitionOfDone` | Objective final acceptance conditions, including integration |
| `nonGoals` | Explicit exclusions that keep the project small |

Each requirement's `concepts` lists **all** prerequisite slugs from the plan or evidenced prior knowledge. Include prerequisites used by its criteria and failure cases. Declare every required technology in `tools` and map it to a required concept; a broad topic label does not establish knowledge of every tool in that field.

Before calling the tool, semantically audit the specification:

1. Can each requirement, test, edge case, design question, and completion condition be satisfied using only the mapped taught/prior-known concepts?
2. Is every central course concept actually applied, not merely listed?
3. Do the requirements work together and require reasoning rather than repeating a lesson example?
4. Can an early requirement be tackled after early lessons, without depending secretly on later work?
5. Are design questions genuinely unanswered and acceptance conditions objectively observable?
6. Does the stated time budget match the scope for this learner?

The tool checks references, coverage, bounds, and required fields. It cannot prove semantic scope, difficulty, or honesty of evidence. Do not claim that a valid object guarantees those qualities. Remove an out-of-scope requirement or simplify it; never label an unknown tool as prior knowledge just to pass validation.

## Work progressively

The full spec is always visible. `Available now` means all mapped concepts have completed mastery evidence or explicit prior-knowledge credit. `Requires later lessons` names the missing concepts. Merely marking a roadmap step `done` does not award mastery. New failed assessments or unresolved misconceptions override earlier credit.

Offer one currently feasible requirement when the learner chooses project work. If none is ready, point to the first required lesson; do not invent a beginner feature outside the plan. Previewing or thinking about a later requirement is allowed. Do not require project work before allowing normal lessons to continue.

Before implementation, ask for the learner's proposed representation/schema (where relevant), pseudocode, and tradeoffs. Challenge assumptions before code. Use a hint ladder: a question, then a conceptual pointer, then a narrow hint. Do not reveal the complete solution unless explicitly requested. A request to build the learning system is not a request to solve its generated exercises.

Learner code lives in their own project files. The generated project note is a specification and review surface, not a code editor. Inspect the actual files or submission the learner supplies; never write their implementation during a plan update.

## Review with evidence

Use `lesson_project_review` after inspecting a learner attempt. Provide:

- `work`: exact files/submission references actually inspected.
- `requirements`: `{requirementId, passed, evidence}` for the requirements reviewed. Evaluate all criteria and edge cases for each; state actual results or explain inspection-only limits. Omitted requirements retain earlier review; re-review affected requirements when shared code changes.
- `designEvidence`: the learner's explanation and your assessment of the design questions. Empty until reviewed.
- `doneEvidence`: evidence for **every** definition-of-done condition, including integration. Empty until verified.
- `feedback`: decisive gaps and the next revision or a justified completion finding.

Run meaningful tests when feasible. Never invent execution, label uninspected code correct, or treat an explanation as proof code works. Ask questions tied to this curriculum: which invariant is protected, what happens on an edge case, what tradeoff was made, or which example would expose a flaw. Do not demand advanced architecture the plan did not teach.

Partial reviews are supported. A passed requirement cannot depend on unfinished learning. Final completion requires every requirement passed and explicit design and definition-of-done evidence. Project review does not replace existing lesson mastery gates. `lesson_finish` reports project status separately, so a learner can finish the lessons and leave the project for later.

## Preserve work when adapting

Omit `miniProject` on normal `lesson_plan` progress updates. The saved specification and review are retained. After scope changes, provide a revised spec whose references and coverage match the new plan. A reviewed project's spec can only be replaced with explicit `reviseProject: true`; discuss the proposed change with the learner first. This clears prior review, because it no longer proves the new specification, while leaving learner implementation files untouched. Preserve requirement identities where the behavior remains the same.
