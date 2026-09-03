---
name: lesson-notes
description: "Use Obsidian for adaptive learning from topics or supplied images, screenshots, PDFs, notes, and code: source-linked plans, scoped mini-projects, lessons, quizzes, and coding exercises. Machine state stays hidden under .learning/."
---

# Lesson Notes

Pi owns reasoning, teaching, adaptation, and grading. Obsidian is the learner-facing interface.

The visible subject layout stays simple:

```text
<subject>/
├── plan/
├── topic/
└── quiz/
```

Internal state lives separately and should not be treated as a human note:

```text
<subject>/.learning/
├── state.json
├── assessments/
├── submissions/
└── results/
```

Never copy machine metadata into the visible Markdown. The learner does not want frontmatter fields such as status, confidence, date, completion, quiz totals, scores, or internal lifecycle state in lesson/plan/quiz documents.

The Pi Learning Obsidian plugin renders `learning-quiz` and `learning-code` blocks as the interactive UI. Do not imitate application controls with Markdown task checkboxes or callout boxes.

## Teach from supplied material

When the learner supplies images, screenshots, a PDF, code, or notes and asks to learn from them, read [references/source-materials.md](references/source-materials.md). Inspect the material **before** constructing the diagnostic or plan. Use `lesson_source` to import files and return page images/text with stable locators. Pasted images submitted after `/learn` are saved automatically and their source references are attached to the input.

Source-backed courses keep copied originals and readable excerpts in `source/`, with manifests under `.learning/sources/`. Each plan step cites inspected excerpts or explicitly explains its added prerequisite/context; lesson notes inherit those references. The mini-project remains constrained by that curriculum. Flag unreadable or incomplete material rather than filling its gaps with guesses.

### Repository source guardrails

When the supplied material is a local repository/directory, startup must stay cheap and bounded. The goal is to get to the diagnostic quickly, not to ingest the repository up front.

- Use at most **3 lightweight shell mapping calls before the first diagnostic**. Each call must have one narrow purpose, such as listing top-level structure, reading a manifest, or locating one likely entrypoint.
- Do **not** build long `&&` chains combining `find`, `rg`, `wc`, `head`, and multiple directory scans into one shell call. Prefer short bounded commands with explicit paths and depth limits.
- If a mapping shell call times out once, **do not retry broader or equivalent variants**. Use the partial information already returned, narrow the scope, or move on to the diagnostic.
- Before the first diagnostic, call `lesson_source` for at most **3 anchor files total**. Typical anchors are a root README/architecture note, one package/workspace manifest, and one goal-relevant entrypoint/module.
- Run those initial `lesson_source` imports **sequentially, never in parallel**. Keep each text excerpt small; request only the lines needed for the map instead of accepting a full 200-line default when a shorter range is enough.
- Do not import extra files merely to increase confidence. Once the purpose, major boundaries, likely entry flow, and 1–3 learning strands are clear enough to ask useful diagnostic questions, stop inspecting and begin the diagnostic immediately.
- Additional repo files are imported **just-in-time during the specific lesson node that needs them**. This is the default path for large repos and monorepos.
- A timeout is a signal to reduce work, not to compensate by launching more source imports or more expensive searches.

These limits apply regardless of whether Pi is running directly, in tmux, or inside Herdr.

## Visible design principles

Visible files are documents for a human to read, not databases.

### Topic note

A topic note begins with only what is useful:

```markdown
# The Agent Loop

How an AI agent repeatedly decides, acts, observes, and decides again.
```

Then create headings only when there is actual content for them. Do not prefill empty sections.

Useful headings often include:

```text
Core idea
Why it exists
Mental model
How it works
Example
What matters
Common mistakes
```

Those are suggestions, not a rigid schema. Use the headings that best explain the current concept.

### Learning plan

Keep the plan compact and readable:

```markdown
# Agent Architecture

A path from basic agent execution to orchestration.

## Goal
...

## Starting point
...

## Dependency map
...

## Path
1. **Agent loop** — current
   Decision → action → observation → next decision.
2. **Tool execution** — next
   How tool calls become real actions and new context.
3. **Delegation**
4. **Parallel orchestration**
```

Do not expose a separate status table, progress database, dates, confidence values, or quiz statistics. Hidden state already tracks those things.

### Quiz files

The quiz file is an assessment surface. The extension writes compact `learning-quiz` or `learning-code` blocks; the Obsidian plugin renders the modern UI.

Do not add green/orange callouts, task-list answers, checkbox submit controls, or duplicate terminal questions.

## Learning lifecycle

Normal flow:

```text
/learn <subject>
      ↓
lesson_start(overall track)
      ↓
diagnostic in Obsidian
      ↓
lesson_plan(clean adaptive roadmap + mini-project)
      ↓
present plan and wait for approval
      ↓
lesson_note(concept)
      ↓
write substantive lesson to topic/<concept>.md
      ↓
learner reads it in Obsidian
      ↓
Obsidian quiz or coding exercise
      ↓
submission automatically reaches Pi
      ↓
adapt / reteach / complete
      ↓
update clean plan
      ↓
next concept
```

## Start and diagnostic

After `/learn <subject>` has been configured and before the first diagnostic assessment:

```text
lesson_start({ topic: "<overall-track-slug>" })
```

This routes the opening diagnostic to:

```text
quiz/<overall-track>-diagnostic.md
```

Use `lesson_obsidian_quiz` for conceptual diagnostic checks.

Use `lesson_code_exercise` during the diagnostic only when implementation ability is genuinely part of the frontier being measured.

The learner submits from Obsidian. Do not ask them to repeat the answer/code in the terminal.

## Plan after the diagnostic

Diagnostic evidence must change the plan.

- mastered prerequisite → mark it `done` or `skipped`
- uncertain edge → make it `current` or `next`
- missing prerequisite → insert it before descendants
- misconception → plan explicit correction
- implementation gap → mark that concept `requiresCode: true` when activating it later

Write the plan with `lesson_plan` using structured steps.

Generate **one mini-project in that same call**, before teaching begins. Read [references/mini-projects.md](references/mini-projects.md) when creating/updating the plan or coaching/reviewing project work. The project is a required plan artifact; doing it is the learner's choice. Its full spec lives in `plan/<track>-project.md`, linked from the plan, and is visible immediately.

Every required concept must map to a plan step or explicit prior-knowledge evidence. Make it challenging through integration, design decisions, and edge cases, within a small scope. Never add untaught frameworks or solve the design for the learner. Requirements show which lessons must be learned first; the entire specification remains visible.

Example concept path:

```text
steps: [
  {
    topic: "agent-loop",
    title: "Agent loop",
    description: "Decision → action → observation → next decision.",
    state: "current"
  },
  {
    topic: "tool-execution",
    title: "Tool execution",
    description: "How tool calls become real actions and new context.",
    state: "next"
  },
  {
    topic: "delegation",
    title: "Delegation",
    state: "upcoming"
  }
]
```

Supply `miniProject` as described in the reference alongside these steps. Then show the learner the plan and project link and wait for approval before teaching.

## Teach a concept in Obsidian first

Before substantive teaching of each graph node:

```text
lesson_note({
  topic: "agent-loop",
  title: "The Agent Loop",
  summary: "How an AI agent repeatedly decides, acts, observes, and decides again.",
  prerequisites: [],
  related: ["tool-execution"],
  requiresCode: true
})
```

`requiresCode` should be true only when implementation/debugging/querying ability is necessary for full understanding of that concept.

Then write the actual lesson using `lesson_write`.

Example:

```text
lesson_write({
  heading: "Core idea",
  content: "<clean durable explanation>",
  mode: "replace"
})
```

And then:

```text
lesson_write({
  heading: "Mental model",
  content: "<clean durable mental model>",
  mode: "replace"
})
```

The extension deliberately refuses lesson-phase assessments until the note contains substantive readable teaching. This is intentional: **lesson first, assessment second**.

Terminal prose should be brief and navigational. Do not make the learner read the actual lesson primarily in the terminal.

## Section-aware writing without rigid templates

`lesson_write` takes a freeform human-readable heading.

Use `mode: "replace"` by default. If a clarification improves an existing section, replace that section with the complete improved explanation instead of appending an “actually...” correction beneath obsolete text.

Use `mode: "append"` only for genuinely additive material, such as another distinct worked example.

Do not create headings merely because a template says they should exist.

## Choose the assessment that proves understanding

A quiz-check means graded evidence that the node landed. It does not mean multiple choice specifically.

Use `lesson_obsidian_quiz` for:

- definitions
- causal reasoning
- architecture distinctions
- prediction
- mental-model checks
- conceptual edge finding

Use `lesson_code_exercise` when full understanding requires producing or repairing code, for example:

- implementing a function/class/API handler
- writing an agent loop
- debugging failing code
- writing SQL
- wiring tools/agents/configuration
- transforming code while preserving behavior
- using a library/API correctly when usage itself is the concept

A passed coding exercise counts as the quiz-check. Do not add a multiple-choice question afterward solely to satisfy wording in another teaching instruction.

Use both only when they measure meaningfully different required dimensions.

## Obsidian conceptual quiz workflow

Create the assessment:

```text
lesson_obsidian_quiz({
  label: "Check 1",
  question: "Why must a tool result be added back into context?",
  options: ["...", "...", "...", "..."],
  correctIndex: 1,
  explanation: "..."
})
```

Then stop and wait.

The Obsidian plugin renders proper selectable options and a real **Submit answer** button. Correct-answer data stays hidden under `.learning/`.

The file submission wakes Pi automatically. Do not ask the learner to type the option again in the terminal.

## Obsidian coding exercise workflow

Create the exercise:

```text
lesson_code_exercise({
  label: "Coding exercise",
  language: "python",
  prompt: "Complete the loop so tool results are fed back into the next model call.",
  starterCode: "def run_agent(model, context):\n    ...",
  criteria: [
    "Calls the model with current context",
    "Executes requested tools",
    "Feeds tool results into the next model call",
    "Stops on a final answer"
  ]
})
```

Then stop and wait.

The learner writes code inside the plugin's editor and presses **Submit code**.

When Pi receives the submission:

1. Evaluate every stated criterion.
2. When feasible and safe, actually run/compile/test the code.
3. Never invent test evidence.
4. Call `lesson_code_result` with the exact submission and verified result.
5. If wrong, explain the decisive gap without immediately dumping the complete solution; reteach and allow a revision.

## Misconceptions

Misconceptions are useful adaptive state but are not required to clutter the visible note.

Use `lesson_misconception` when evidence supports an actual mistaken mental model. Do not turn every wrong click into a misconception.

The misconception remains hidden under `.learning/state.json` and blocks completion until resolved.

When corrected, call it again with the same misconception text and `resolved: true`.

## Quality and completion

Before completing a concept:

```text
lesson_quality({})
```

The quality gate checks for readable substance rather than a rigid set of six template headings. It also checks hidden mastery evidence, unresolved misconceptions, and required coding evidence.

Then:

```text
lesson_progress({ status: "complete" })
```

Completion should fail when:

- the note is still too thin
- there are empty/template sections
- unresolved misconceptions remain
- no assessment has been completed
- the latest assessment is incorrect
- `requiresCode` is true but no successful coding exercise exists

After a concept is completed, update `lesson_plan` so the visible **Path** shows the new current/next nodes without exposing machine statistics. Omit `miniProject` on ordinary updates to preserve the existing specification and review. Readiness refreshes after mastery changes. If an adaptive plan introduces/removes concepts, reconcile project scope in the same update; never quietly replace a reviewed project or overwrite learner implementation files.

## Core rule

The visible vault should feel like a polished course written for the learner.

The hidden `.learning/` directory should feel like the database backing that course.

Never confuse the two.
