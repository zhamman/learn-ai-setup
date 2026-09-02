---
name: lesson-notes
description: Keep teaching output as a current learning plan, clean topic notes, and separate quiz history in Obsidian. Use whenever the teach skill is active and the lesson-log extension is available.
---

# Lesson Notes

Use the `lesson-log` extension to keep three different learning artifacts separate:

```text
<subject>/
├── plan/
├── topic/
└── quiz/
```

For example:

```text
ai-engineering/
├── plan/
│   └── context-engineering.md
├── topic/
│   ├── context-window.md
│   └── tool-calling.md
└── quiz/
    ├── context-engineering-diagnostic.md
    ├── context-window-lesson.md
    └── tool-calling-lesson.md
```

`plan/` is the current learning roadmap.
`topic/` is the clean durable knowledge base.
`quiz/` is the learner's testing history.

Ordinary chat is not copied into any of them.

## At the start of a learning session

The learner controls the subject directory. If none has been configured, ask them to run:

```text
/learn <subject-directory>
```

Examples:

```text
/learn ai-engineering
/learn python/oop
/learn databases/postgres
```

Do not silently invent or change the learner's subject directory.

## Opening diagnostic quiz

Before the FIRST pre-instruction knowledge-check quiz, call:

```text
lesson_quiz_context({
  topic: "<overall-requested-lesson-slug>",
  phase: "diagnostic"
})
```

Example:

```text
lesson_quiz_context({
  topic: "context-engineering",
  phase: "diagnostic"
})
```

All questions used to gauge the learner before teaching begins should remain in:

```text
quiz/context-engineering-diagnostic.md
```

Use the overall lesson being assessed, not the first dependency concept, for the diagnostic filename.

## Overall learning plan

After the diagnostic/probe, use what the learner demonstrated to build the dependency map and learning sequence.

Save the current roadmap with:

```text
lesson_plan({
  topic: "<overall-requested-lesson-slug>",
  content: "<complete current plan body>"
})
```

For context engineering this writes:

```text
plan/context-engineering.md
```

Use the same overall slug as the diagnostic when they refer to the same learning track.

The plan should normally contain:

```markdown
## Goal

## Starting Point

## Dependency Map

## Learning Sequence

- [ ] Concept A
- [ ] Concept B

## Current Position

## Next
```

The diagnostic should influence `Starting Point` and the sequence. Do not paste the full diagnostic transcript into the plan.

`lesson_plan` REPLACES the previous plan body. Pass the complete latest plan each time so the file represents the current state rather than accumulating stale versions.

Update the plan after meaningful changes such as:
- the learner approves or changes the proposed sequence
- a concept is completed
- a prerequisite gap is discovered
- the current position or next concept changes

Do not rewrite it for every conversational turn.

## Automatic topic switching

Before the first substantive explanation of each distinct concept/node, call:

```text
lesson_note({ topic: "<stable-concept-slug>" })
```

Examples:

```text
lesson_note({ topic: "context-window" })
lesson_note({ topic: "tool-calling" })
lesson_note({ topic: "agent-harness" })
```

This automatically:

1. activates `topic/<concept>.md`
2. routes subsequent quizzes to `quiz/<concept>-lesson.md`

Reuse the same concept slug when revisiting a concept. Do not create `topic-2`, `part-2`, or date-based duplicates.

Do not switch concept notes merely because:
- the learner asked a clarification
- a quiz occurred
- a researcher was consulted
- the teaching style changed
- another example is being given
- the same concept is being revisited

## Durable topic writing

After teaching something worth preserving, call:

```text
lesson_write({
  content: "<clean standalone Markdown>"
})
```

`lesson_write` writes only to the active file under `topic/`.

Good durable content includes:
- the core explanation
- a useful mental model
- an important distinction
- concise code examples
- Mermaid diagrams
- worked examples worth revisiting

Do not write:
- greetings or praise
- conversational filler
- process commentary
- researcher/subagent chatter
- tool-call descriptions
- quiz questions or quiz results
- the overall learning roadmap

The roadmap belongs under `plan/`. Quiz content belongs under `quiz/`.

## Quiz behavior

Diagnostic quizzes go to:

```text
quiz/<overall-topic>-diagnostic.md
```

Quizzes during instruction go to:

```text
quiz/<current-concept>-lesson.md
```

Each completed question/result pair is preserved chronologically:

```text
## Quiz 1
Question
Result

## Quiz 2
Question
Result
```

Do not duplicate quiz content with `lesson_write`.

## Teaching integration

When using `teach`:

1. Determine the overall lesson/topic the learner requested.
2. Before the opening assessment, call `lesson_quiz_context` with the overall slug and `phase: "diagnostic"`.
3. Probe the learner. Store the pre-instruction baseline under `quiz/`.
4. Build a dependency map and learning sequence informed by the diagnostic.
5. Call `lesson_plan` with the overall slug and complete proposed plan.
6. Present the plan and wait for learner approval before teaching.
7. If the learner changes the plan, update `lesson_plan` with the complete revised version.
8. Before the first concept, call `lesson_note` for that concept.
9. Teach conversationally.
10. Call `lesson_write` with the distilled durable version.
11. Quiz the concept. It is automatically stored in `quiz/<concept>-lesson.md`.
12. When a concept is meaningfully complete, update `lesson_plan` to mark progress and set `Current Position` / `Next`.
13. When moving to the next concept, call `lesson_note` first; both topic-note and lesson-quiz routing switch automatically.

The topic boundary follows the knowledge dependency graph, not arbitrary chat turns.
