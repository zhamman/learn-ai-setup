---
name: lesson-notes
description: Maintain an adaptive learning track as standardized Obsidian plans, topic notes, quiz history, and coding-assessment evidence. Use with the teach skill and lesson-log extensions.
---

# Lesson Notes

Pi chat is the working conversation. Obsidian is the durable learning system.

The learner chooses one subject with `/learn`. Every subject uses exactly three artifact directories:

```text
<subject>/
├── plan/
├── topic/
└── quiz/
```

Example:

```text
ai-engineering/
├── plan/
│   └── agent-orchestration.md
├── topic/
│   ├── agent-loop.md
│   ├── supervisor-pattern.md
│   └── handoffs.md
└── quiz/
    ├── agent-orchestration-diagnostic.md
    ├── agent-loop-lesson.md
    └── supervisor-pattern-lesson.md
```

`plan/` is the current adaptive roadmap. `topic/` is the clean knowledge base. `quiz/` is chronological assessment evidence. A quiz file may contain multiple-choice/reasoning quizzes, coding exercises, or both. Ordinary chat belongs in none of them.

## 1. Standardized artifacts

The extensions own frontmatter, headings, paths, assessment statistics, and timestamps. Do not manually reproduce those structures inside tool content.

A topic note has standardized metadata plus these sections:

```text
# Concept
## Core Idea
## Why It Exists
## Mental Model
## How It Works
## Example
## Common Mistakes
## Misconceptions
## Related Concepts
## Notes
```

Topic frontmatter tracks at least `type`, `subject`, `topic`, `status`, `confidence`, `updated`, `prerequisites`, `related`, and assessment statistics.

A plan has:

```text
# Track — Learning Plan
## Goal
## Starting Point
## Dependency Map
## Learning Sequence
## Progress
## Current Position
## Next
```

A quiz file has standardized frontmatter identifying its subject, topic, diagnostic/lesson phase, status, date, cumulative assessment score, and coding-exercise statistics when code exercises are used.

## 2. Explicit lesson lifecycle

Normal teaching follows this lifecycle:

```text
start
  ↓
diagnostic
  ↓
plan
  ↓
teach concept
  ↓
assess (quiz OR coding exercise)
  ↓
adapt / complete concept
  ↓
next concept
  ↓
finish
```

### Start

After `/learn <subject>` is configured and before the first diagnostic assessment, call:

```text
lesson_start({
  topic: "<overall-track-slug>",
  title: "<optional readable title>"
})
```

This initializes the plan and routes the opening assessment to:

```text
quiz/<overall-track>-diagnostic.md
```

Do not call `lesson_note` before the diagnostic unless the learner explicitly skips probing.

### Diagnostic

Use the `teach` skill's probe phase to map the learner's frontier.

Use ordinary `quiz` when the thing being measured is conceptual knowledge, reasoning, distinctions, or prediction. Use `lesson_code_exercise` when the frontier cannot be established without seeing whether the learner can actually write, debug, transform, configure, or query code.

For a coding-heavy track, a diagnostic may legitimately mix both modalities. Do not use a coding exercise merely because the subject happens to involve software; use it only when implementation ability is part of the relevant learning objective.

If the diagnostic reveals a genuine mistaken mental model, not merely one careless miss, record it against the relevant concept with `lesson_misconception`.

A diagnostic misconception may create the standardized topic note before that concept is taught. That is intentional: the gap is durable learning state.

### Plan

After the diagnostic is sufficiently mapped, build the dependency DAG and call `lesson_plan` with the complete current roadmap.

The diagnostic must materially affect the plan:

- mastered prerequisite → mark checked/skipped rather than reteaching by default
- uncertain edge → teach it
- missing deeper prerequisite → insert it before descendants
- misconception → preserve it and plan explicit correction
- implementation gap → include a coding exercise at the node where practical competence must be demonstrated

Then present the plan to the learner and wait for approval, as required by `teach`.

### Teach

Before substantive teaching of each graph node, call `lesson_note` with the concept slug and known prerequisite/related slugs.

This activates:

```text
topic/<concept>.md
```

and automatically routes assessments to:

```text
quiz/<concept>-lesson.md
```

Write durable knowledge section-by-section with `lesson_write`.

## Assessment modality: choose what proves understanding

The phrase **quiz-check** in the `teach` skill means **graded evidence that the node landed**. It does not require multiple-choice.

Choose the assessment that measures the actual objective:

```text
Can understanding be demonstrated by selecting/reasoning about a correct claim?
        ↓ yes
      quiz

Does full understanding require producing/debugging/configuring/querying code?
        ↓ yes
lesson_code_exercise
```

Use `quiz` for definitions, causal reasoning, architecture distinctions, mental-model checks, prediction, and conceptual edge finding.

Use `lesson_code_exercise` when the learner must be able to do something in code, for example:

- implement a function, class, API handler, algorithm, or orchestration pattern
- complete or repair incomplete code
- debug a real bug or explain/fix failing behavior
- write a SQL query
- wire together tools/agents/configuration
- transform code while preserving required behavior
- use a library/API correctly when usage itself is part of the concept

Do not force coding exercises onto concepts whose learning objective is genuinely conceptual.

A **passed coding exercise counts as the quiz-check for that node**. Do not add a multiple-choice quiz afterward solely because another instruction says “quiz-check.” Use both only when they test meaningfully different dimensions of understanding.

For implementation-heavy concepts, do not mark the concept complete until the learner has successfully completed at least one coding exercise that actually tests the required implementation skill.

## Coding-exercise workflow

Create a coding assessment with:

```text
lesson_code_exercise({
  language: "python",
  prompt: "Implement ...",
  starterCode: "def ...",
  criteria: [
    "Handles ...",
    "Returns ...",
    "Does not ..."
  ]
})
```

The tool logs the exercise in the current diagnostic/lesson quiz file and returns an `exerciseId`.

Then present the exercise to the learner and wait for their code. Do not reveal the solution or solution-shaped pseudocode before they attempt it.

When the learner submits code:

1. Evaluate it against every stated acceptance criterion.
2. When feasible and safe, actually run, compile, lint, or test the code rather than grading only by inspection.
3. Do not invent test results. Only report evidence you actually observed.
4. Record the exact submission and grade with `lesson_code_result`.

Example:

```text
lesson_code_result({
  exerciseId: "agent-loop-code-1",
  submission: "<learner code>",
  correct: false,
  feedback: "The loop retries correctly, but it never feeds the tool result back into the next model call.",
  testEvidence: "Observed failing case: ..."
})
```

An incorrect exercise remains open for revised submissions. Let the learner repair the same exercise when that is pedagogically useful instead of immediately replacing it with a new one.

Coding attempts count as assessment evidence in the same mastery statistics used by normal lesson quizzes. A failed coding attempt sets the latest assessment state to incorrect, so normal concept completion remains blocked until the concept is repaired and subsequently verified.

If a coding failure reveals a genuine misconception, use `lesson_misconception`. If it exposes a missing prerequisite or changes the optimal graph, revise `lesson_plan` before advancing.

## 3. Misconception tracking

Misconceptions are durable state, not throwaway assessment commentary.

Use `lesson_misconception` only when evidence supports an actual wrong model. Do not turn every wrong quiz answer, syntax typo, or coding bug into a misconception.

Unresolved entries appear as unchecked items in `## Misconceptions` and block concept completion. Resolved entries become checked items. Use the exact same `misconception` wording when resolving an existing entry so the extension updates it instead of creating a duplicate.

The correction should state the replacement mental model positively, not merely say the previous answer was wrong.

## 4. Assessment-driven adaptive graph

Treat assessment data as control signals for the teaching graph.

```text
correct assessment + good note + no unresolved misconception
                         ↓
                  concept can complete

miss / failed code / don't know
            ↓
inspect the weak edge
            ↓
reteach / repair prerequisite
            ↓
reassess with the modality that actually proves the objective
            ↓
update plan if graph changed
```

Do not advance merely because the concept was explained once.

A recognition-only quiz should not override evidence that the learner still cannot perform an implementation skill required by the node. Conversely, do not demand code for a purely conceptual node simply to make assessment harder.

## 5. Concept prerequisites and backlinks

The learning plan is a dependency graph, so preserve those edges in the notes.

Whenever calling `lesson_note`, pass known prerequisite slugs and useful related slugs. Use stable concept slugs that correspond to note filenames.

A prerequisite means the current explanation genuinely depends on it. `related` means useful conceptual adjacency without strict dependency. Do not invent relationships merely to fill metadata.

If a relationship changes because the learner's graph changes, call `lesson_note` again with the corrected arrays.

## 9. Note-quality evaluator

Before treating a concept as complete, call:

```text
lesson_quality({})
```

It checks mechanically for standardized metadata, required sections, suspiciously thin content, unresolved misconceptions, and assessment evidence.

Then perform the semantic checks the extension cannot automate reliably:

- Is every claim accurate?
- Does the note make sense without the chat?
- Are explanations motivated/connected rather than arbitrary where appropriate?
- Did clarification supersede wording that should be replaced?
- Is anything repeated or contradictory?
- Did conversational/process language leak into the note?

Repair the note before `lesson_progress({ status: "complete" })`.

For implementation-heavy nodes, also verify that successful coding-assessment evidence exists before calling the concept complete.

## 10. Section-aware topic updates

Never dump free-form lesson prose onto the end of a topic file.

Use:

```text
lesson_write({
  section: "core-idea",
  content: "<complete current Core Idea section>",
  mode: "replace"
})
```

Available section keys are:

```text
core-idea
why-it-exists
mental-model
how-it-works
example
common-mistakes
notes
```

Default to `mode: "replace"`. When clarification improves an explanation, replace that section with the better complete version instead of appending a correction fragment.

Use `mode: "append"` only for genuinely additive material, primarily an additional distinct example or a small durable note.

`## Misconceptions` is managed through `lesson_misconception`. `## Related Concepts` is managed from `lesson_note` relationship metadata. Assessment content belongs under `quiz/`, not in topic notes.

## Completing a concept

After the appropriate assessment succeeds:

1. Resolve any genuine misconceptions that have been demonstrably corrected.
2. Run `lesson_quality({})` and repair the note.
3. For implementation-heavy concepts, confirm a coding exercise passed.
4. Call `lesson_progress({ status: "complete" })`.
5. Update `lesson_plan` so Progress, Current Position, Next, and the checklist match the evidence.

If a prerequisite gap prevents progress instead, use `lesson_progress({ status: "blocked", reason: "..." })` and revise the plan.

## Finishing the track

When all approved plan nodes are done, make one final `lesson_plan` update with the completed checklist and call `lesson_finish`.

`lesson_finish` normally refuses while unchecked learning-sequence items remain. `force: true` is only for an explicit learner request to stop early.

## Full integration with `teach`

The normal combined flow is:

```text
/learn <subject>
        ↓
lesson_start(overall track)
        ↓
teach Phase 1: diagnostic probe
        ↓
quiz and/or coding exercise as required to map the true frontier
        ↓
record real misconceptions
        ↓
lesson_plan(adaptive DAG)
        ↓
present plan + wait for approval
        ↓
lesson_note(concept + prerequisites/related)
        ↓
teach node conversationally
        ↓
lesson_write(section-aware durable knowledge)
        ↓
choose assessment modality
   ↙                 ↘
quiz          coding exercise
   ↘                 ↙
       graded evidence
              ↓
miss/fail? → diagnose/reteach/misconception/plan adaptation/reassess
              ↓
lesson_quality
              ↓
lesson_progress(complete)
              ↓
lesson_plan(update progress + next)
              ↓
next concept
              ↓
lesson_finish
```

The topic boundary follows the knowledge graph, not chat turns. The plan tracks the graph, topic notes track durable understanding, and quiz files track assessment evidence—including code when code is what understanding requires.
