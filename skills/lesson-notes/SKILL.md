---
name: lesson-notes
description: Maintain an adaptive learning track as standardized Obsidian plans, topic notes, and quiz history. Use with the teach skill and lesson-log extension.
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

`plan/` is the current adaptive roadmap. `topic/` is the clean knowledge base. `quiz/` is chronological testing evidence. Ordinary chat belongs in none of them.

## 1. Standardized artifacts

The extension owns frontmatter, headings, paths, quiz statistics, and timestamps. Do not manually reproduce those structures inside tool content.

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

Topic frontmatter tracks at least `type`, `subject`, `topic`, `status`, `confidence`, `updated`, `prerequisites`, `related`, and quiz statistics.

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

A quiz file has standardized frontmatter identifying its subject, topic, diagnostic/lesson phase, status, date, and cumulative quiz score.

## 2. Explicit lesson lifecycle

Normal teaching follows this lifecycle exactly:

```text
start
  ↓
diagnostic
  ↓
plan
  ↓
teach concept
  ↓
quiz
  ↓
adapt / complete concept
  ↓
next concept
  ↓
finish
```

### Start

After `/learn <subject>` is configured and before the first diagnostic question, call:

```text
lesson_start({
  topic: "<overall-track-slug>",
  title: "<optional readable title>"
})
```

Example:

```text
lesson_start({ topic: "agent-orchestration" })
```

This initializes the plan and routes the opening quiz to:

```text
quiz/agent-orchestration-diagnostic.md
```

Do not call `lesson_note` before the diagnostic unless the learner explicitly skips probing.

### Diagnostic

Use the `teach` skill's probe phase normally. The diagnostic is mapping the learner's current frontier, not teaching.

All opening probe questions are automatically stored in the diagnostic quiz file.

If the diagnostic reveals a genuine mistaken mental model, not merely one careless wrong answer, record it against the relevant concept:

```text
lesson_misconception({
  topic: "supervisor-pattern",
  misconception: "A supervisor must execute every worker's task itself",
  correction: "A supervisor coordinates work; execution can remain delegated to workers",
  evidence: "Diagnostic answer treated delegation as impossible"
})
```

A diagnostic misconception may create the standardized topic note before that concept is taught. That is intentional: the gap is durable learning state.

### Plan

After the diagnostic is sufficiently mapped, build the dependency DAG and call `lesson_plan`:

```text
lesson_plan({
  topic: "agent-orchestration",
  goal: "...",
  startingPoint: "...",
  dependencyMap: "```mermaid\n...\n```",
  learningSequence: "- [ ] agent-loop\n- [ ] supervisor-pattern\n- [ ] handoffs",
  progress: "Diagnostic complete; ...",
  currentPosition: "Plan review",
  next: "agent-loop"
})
```

Then present the plan to the learner and wait for approval, as required by `teach`. If the learner changes scope/order, call `lesson_plan` again with the complete current version.

The plan is section-aware and current-state oriented. Do not append historical plan fragments.

### Teach

Before substantive teaching of each graph node, activate that concept and its graph relationships:

```text
lesson_note({
  topic: "supervisor-pattern",
  prerequisites: ["agent-loop"],
  related: ["handoffs", "agent-as-tool"]
})
```

This activates:

```text
topic/supervisor-pattern.md
```

and automatically routes quizzes to:

```text
quiz/supervisor-pattern-lesson.md
```

The extension records prerequisites and related concepts in frontmatter and explicit Obsidian links. Existing related notes also receive backlinks.

### Quiz and adapt

Every completed lesson quiz is stored automatically. Quiz results are also reflected in topic metadata (`quiz_total`, `quiz_correct`, score, confidence, and latest-result state).

Quiz performance is not archival only; it controls advancement:

- If the learner misses or answers "I don't know", do not mark the concept complete.
- Probe around a miss before declaring it a misconception.
- If it is a true misconception, record it with `lesson_misconception(... resolved: false)`.
- Reteach the weak edge, update the durable note, and requiz.
- If the miss exposes a prerequisite gap or changes the optimal sequence, revise `lesson_plan` before advancing.
- If a previously recorded misconception is demonstrably corrected, call `lesson_misconception` again with the same misconception wording and `resolved: true`.

The diagnostic should also adapt the graph. If the learner clearly demonstrates mastery of a planned node, mark that node checked/skipped in `Learning Sequence` instead of reteaching it by default. If probing exposes a missing prerequisite, add it to the graph before dependent nodes.

### Finish a concept

Before treating a concept as complete, call:

```text
lesson_quality({})
```

Repair any missing or thin required sections. Also perform a semantic audit yourself: the note must be accurate, standalone, non-redundant, and free of chat/process filler. Mechanical structure passing is not a substitute for factual review.

Then call:

```text
lesson_progress({ status: "complete" })
```

Completion is deliberately gated. It will fail if the note is structurally weak, unresolved misconceptions remain, no lesson quiz evidence exists, or the latest lesson quiz was not correct.

If a prerequisite gap prevents progress instead:

```text
lesson_progress({
  status: "blocked",
  reason: "Needs agent-loop delegation semantics first"
})
```

After meaningful progress/blocking, update `lesson_plan` so its checklist, Progress, Current Position, and Next match the evidence.

### Finish the track

When all approved plan nodes are done, make one final `lesson_plan` update with all completed checklist items and then call:

```text
lesson_finish({
  summary: "Completed the orchestration track and verified each concept with lesson quizzes."
})
```

`lesson_finish` normally refuses while unchecked plan items remain. `force: true` is only for an explicit learner request to stop early.

## 3. Misconception tracking

Misconceptions are durable state, not throwaway quiz commentary.

Use `lesson_misconception` only when evidence supports an actual wrong model. Do not turn every wrong answer into a misconception.

Unresolved entries appear as unchecked items in `## Misconceptions` and block concept completion. Resolved entries become checked items. Use the exact same `misconception` wording when resolving an existing entry so the extension updates it instead of creating a duplicate.

The correction should state the replacement model positively. Prefer:

```text
Correction: A handoff transfers control/responsibility to another agent.
```

over:

```text
Correction: Your answer was wrong.
```

## 4. Quiz-driven adaptive graph

Treat quiz data as control signals for the teaching graph.

Diagnostic evidence controls the initial graph:

- mastered prerequisite → skip/check it
- uncertain edge → teach it
- missing deeper prerequisite → insert it before descendants
- misconception → preserve it and plan explicit correction

Lesson-quiz evidence controls whether the graph can advance:

```text
correct + good note + no unresolved misconception
                 ↓
          concept can complete

miss / don't know
       ↓
reteach or inspect prerequisite
       ↓
requiz
       ↓
update plan if graph changed
```

Do not advance just because you already explained the concept once.

## 5. Concept prerequisites and backlinks

The learning plan is a dependency graph, so preserve those edges in the notes.

Whenever calling `lesson_note`, pass known prerequisite slugs and useful related slugs. Use stable concept slugs that correspond to note filenames.

Example:

```text
lesson_note({
  topic: "parallel-orchestration",
  prerequisites: ["agent-loop", "tool-calling"],
  related: ["supervisor-pattern"]
})
```

Do not invent relationships merely to fill metadata. A prerequisite means the current explanation genuinely depends on it. `related` means useful conceptual adjacency without strict dependency.

If a relationship changes because the learner's graph changes, call `lesson_note` again with the corrected arrays.

## 9. Note-quality evaluator

`lesson_quality` is a pre-completion gate, not a cosmetic score.

It checks mechanically for:

- standardized topic metadata
- required sections that are missing
- required sections that are suspiciously thin
- unresolved misconception checklist items
- lesson quiz evidence

After receiving its report, perform the semantic checks the extension cannot reliably automate:

- Is every claim accurate?
- Does the note make sense without the chat?
- Are explanations derived/motivated rather than arbitrary facts where appropriate?
- Did clarification supersede old wording that should be replaced?
- Is anything repeated or contradictory?
- Did conversational/process language leak into the note?

Repair the note before `lesson_progress({ status: "complete" })`.

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

Default to `mode: "replace"`. This is the key behavior that lets an exploratory chat converge into one clean note: when a clarification improves the explanation, replace that section with the better complete version instead of appending "actually..." below the old one.

Use `mode: "append"` only for genuinely additive material, primarily an additional distinct example or a small durable note. Do not append a correction to obsolete prose.

`## Misconceptions` is managed through `lesson_misconception`. `## Related Concepts` is managed from `lesson_note` relationship metadata. Quiz content is captured automatically. Do not manually write into those sections with `lesson_write`.

## Full integration with `teach`

The normal combined flow is:

```text
/learn <subject>
        ↓
lesson_start(overall track)
        ↓
teach Phase 1: diagnostic probe
        ↓
record real misconceptions as discovered
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
quiz
        ↓
miss? → diagnose/reteach/misconception/plan adaptation/requiz
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

The topic boundary follows the knowledge graph, not chat turns. The plan tracks the graph, topic notes track durable understanding, and quiz files track evidence.
