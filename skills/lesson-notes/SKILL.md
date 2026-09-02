---
name: lesson-notes
description: Keep teaching output as clean topic-based Obsidian notes instead of chat transcripts. Use whenever the teach skill is active and the lesson-log extension is available.
---

# Lesson Notes

Use the `lesson-log` extension to keep durable learning notes organized by concept.

## Core rule

Pi chat is the working conversation. Obsidian notes are the clean knowledge artifact.

Ordinary chat is NOT copied into Obsidian. You must deliberately save durable teaching material with `lesson_write`.

Your responsibilities are:

1. switch to the correct concept note with `lesson_note`
2. teach conversationally in chat
3. deliberately write the clean, standalone version of durable knowledge with `lesson_write`
4. let quiz logging happen automatically

## At the start of a learning session

The learner controls the subject directory. If none has been configured, ask them to run:

```text
/learn <subject-directory>
```

Examples:

```text
/learn python/oop
/learn ai-engineering
/learn databases/postgres
```

Do not silently invent or change the learner's subject directory.

## Automatic topic switching

Once `/learn` is configured, YOU switch notes automatically with `lesson_note`.

Before the first substantive explanation of a distinct concept/node, call:

```text
lesson_note({ topic: "<stable-concept-slug>" })
```

Examples:

```text
lesson_note({ topic: "classes" })
lesson_note({ topic: "self" })
lesson_note({ topic: "inheritance" })
lesson_note({ topic: "composition" })
```

The learner should not need to run `/lesson` during a normal teaching session. `/lesson` exists only as a manual escape hatch.

A new note is appropriate when the lesson dependency graph moves to a concept that could stand alone as a useful future reference.

Do NOT switch notes merely because:
- the learner asked a clarification about the current concept
- a quiz occurred
- a researcher was consulted
- the teaching style changed
- an additional example is being given
- the same concept is being revisited

If the concept is revisited later, reuse the exact same slug so the same Markdown note is enriched rather than creating `topic-2.md`, `topic-part-2.md`, or a date-based duplicate.

## Explicit durable writing

After teaching something worth preserving, call:

```text
lesson_write({
  content: "<clean standalone Markdown>"
})
```

The content passed to `lesson_write` should be the durable version of the lesson, not a transcript of what you just said.

Good `lesson_write` content includes:
- the core explanation of the concept
- a useful mental model
- an important distinction
- a concise code example
- a Mermaid diagram block
- a short worked example that will still be useful later

Do NOT write:
- greetings or praise
- "Great question"
- "Let's continue"
- statements about what you are about to teach
- researcher/subagent process commentary
- tool-call descriptions
- repeated conversational clarification that adds no durable knowledge
- quiz questions/results, because the extension logs those automatically

Not every assistant response requires `lesson_write`.

A useful pattern is:

```text
chat explanation
↓
learner clarification
↓
refined understanding
↓
lesson_write(clean distilled version)
↓
quiz
```

This lets the conversation be exploratory while the Obsidian note remains concise.

## What belongs in the note

The active note should receive only:
- deliberately curated lesson material written through `lesson_write`
- quiz questions
- quiz answers and explanations

Write lesson material so it makes sense later without the surrounding chat.

## Teaching integration

When using the `teach` skill:

1. Probe and plan normally.
2. Present the dependency map before teaching.
3. Wait for the learner to approve the plan.
4. Identify the first concept/node.
5. Call `lesson_note` for that concept BEFORE teaching it.
6. Teach conversationally.
7. Once the explanation has stabilized, call `lesson_write` with the clean durable version.
8. Quiz the concept; quiz Q&A is logged automatically.
9. If clarification materially improves the durable explanation, call `lesson_write` again with only the new useful material.
10. When the graph moves to the next distinct concept, call `lesson_note` first.
11. At the end, leave the last lesson active unless the learner asks to stop logging.

The topic boundary follows the knowledge graph, not arbitrary chat turns.
