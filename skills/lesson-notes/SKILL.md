---
name: lesson-notes
description: Keep teaching output as clean topic-based Obsidian notes instead of chat transcripts. Use whenever the teach skill is active and the lesson-log extension is available.
---

# Lesson Notes

Use the `lesson-log` extension to keep durable learning notes organized by concept.

## Core rule

Pi chat is the working conversation. Obsidian notes are the clean knowledge artifact.

Do not mirror ordinary user chatter, orchestration, researcher chatter, or tool noise into the notes. The extension already filters those. Your job is to switch the active note at the right semantic boundary.

## At the start of a learning session

If no learning directory is set, ask the learner which subject directory to use, then instruct them to run:

```text
/learn <subject-directory>
```

Examples:

```text
/learn python/oop
/learn ai-engineering
/learn databases/postgres
```

Do not invent a broad folder hierarchy when the learner has already chosen one.

## When to start a new lesson note

Before teaching a distinct concept/node in the lesson dependency graph, switch to a topic note with:

```text
/lesson <short-topic-slug>
```

Examples:

```text
/lesson classes
/lesson self
/lesson inheritance
/lesson composition
```

A new note is appropriate when the learner has moved to a concept that could stand alone as a useful future reference.

Do NOT create a new note merely because:
- the learner asked a clarification about the current concept
- a quiz occurred
- a researcher was consulted
- the teaching style changed
- the same concept is being revisited

If the concept is revisited later, use the same slug so the same Markdown note is enriched rather than creating `topic-2.md`.

## What belongs in the note

The active note should receive:
- lesson prose that teaches the concept
- concise examples that are part of the lesson
- useful Mermaid or visual embeds
- quiz questions
- quiz answers and explanations

The active note should NOT become a transcript. Avoid writing conversational filler such as:
- "Great question"
- "Let's continue"
- process commentary about subagents/tools
- explanations of what you are about to do rather than the lesson itself

Write lesson prose so it reads well later without the chat around it.

## Teaching integration

When using the `teach` skill:

1. Probe and plan normally.
2. Present the dependency map before teaching.
3. After the learner approves the plan, identify the first concept/node.
4. Switch to that concept's `/lesson` note before teaching it.
5. Teach and quiz the concept.
6. When moving to the next distinct concept, switch `/lesson` first.
7. Keep clarifications and retries in the current concept note.
8. At the end, leave the last lesson active unless the learner asks to stop logging.

The topic boundary should follow the knowledge graph, not arbitrary chat turns.
