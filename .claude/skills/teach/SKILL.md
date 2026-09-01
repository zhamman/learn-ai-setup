---
name: teach
description: Teach a concept so it is understood from foundations rather than memorized. Use for explanations, learning sessions, conceptual comparisons, and when the user asks how or why something works.
---

# Teach for understanding

The objective is durable understanding: the learner should be able to reconstruct the idea from a small set of foundations instead of memorizing disconnected facts.

## Core principles

### 1. Establish solid foundations first

Before introducing jargon or implementation detail, identify the few simplest facts the rest of the explanation depends on.

A good foundation should be:

- precise
- easy to accept without hidden caveats
- actually relevant to what follows

Do not call something foundational merely because it sounds important. If it depends on a simpler idea the learner needs first, go lower.

### 2. Make every step feel motivated

For each important idea, answer:

- What problem are we trying to solve?
- Why would someone reach for this idea?
- What does it add that the previous idea could not do?
- How does it connect to what we already established?

Avoid presenting arbitrary-looking facts when a motivated path can be shown.

## Session shape

For substantial topics, use this sequence.

### Phase 1: Probe

Determine two things:

1. Current understanding.
2. Desired outcome.

Use a few increasingly difficult questions to locate the learner's boundary rather than assuming beginner or expert level.

Do not turn a simple question into an interrogation. Scale the probe to the topic.

### Phase 2: Plan

Before a deep lesson, state the route briefly:

- starting foundations
- concepts that will be derived from them
- final target

When dependency structure matters, include a small Mermaid diagram, for example:

```mermaid
graph TD
    A[Foundation] --> B[Derived concept]
    B --> C[Target understanding]
```

Keep diagrams small and semantic. A diagram should reveal structure, not decorate the answer.

For current or uncertain AI topics, delegate focused verification to the `researcher` subagent before teaching claims as fact.

### Phase 3: Teach node by node

For each important concept:

1. **Motivate** — why is this needed now?
2. **Establish** — explain or derive it.
3. **Connect** — explicitly link it to earlier concepts.
4. **Check** — ask one short knowledge-check question when the concept is important enough that later material depends on it.

Do not stack multiple major concepts on top of an unverified misunderstanding.

## Knowledge checks

When asking a multiple-choice question:

- keep answer choices parallel in structure and length
- do not make the correct answer obviously more detailed
- use plausible misconceptions as distractors
- do not reveal the explanation until after the learner answers

When the learner is wrong, explain the mistaken model that would produce that answer and repair it before continuing.

## Explanation style

Prefer this order:

1. plain-language mental model
2. concrete example
3. precise terminology
4. implementation detail

Use analogies only when their mapping is explicit. State where an analogy stops being accurate if that boundary matters.

For software/agent topics, execution traces are often better than prose. Example:

```text
user request
  -> harness
  -> model decision
  -> tool call
  -> tool result
  -> model decision
  -> final output
```

## Accuracy

Do not confidently teach uncertain facts.

When a claim is current, vendor-specific, obscure, or uncertain:

- verify it using authoritative sources when tools are available
- prefer primary documentation over summaries
- state unresolved uncertainty clearly

Accuracy matters more than maintaining conversational momentum.
