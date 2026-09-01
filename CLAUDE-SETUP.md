# Claude Code learning setup

This repository started as a Pi learning configuration. The original `skills/`, `agents/`, and `extensions/` directories are kept intact as reference.

Claude Code-specific configuration lives under `.claude/` plus the root `CLAUDE.md`.

## Current Claude-native pieces

### `CLAUDE.md`
Project-level instructions that tell Claude this repo is for learning and that explanations should build from foundations, expose dependencies, verify current AI claims, and use the teaching workflow when appropriate.

### `.claude/skills/teach/SKILL.md`
A portable version of the original teaching philosophy. It keeps the core ideas:

- establish solid foundations first
- motivate how each idea could be discovered
- probe current understanding
- plan the dependency path
- teach node by node
- use knowledge checks
- verify uncertain/current claims

It intentionally does not depend on Pi's custom `quiz` or `ask-user-question` tools. Claude asks the questions directly in chat.

### `.claude/agents/researcher.md`
An isolated research subagent for current, uncertain, obscure, or vendor-specific claims. It returns evidence to the main teaching agent instead of filling the main context with a long research trail.

## What has NOT been ported yet

### Pi extensions

These are Pi-specific and do not directly run inside Claude Code:

- `extensions/ask-user-question.ts`
- `extensions/quiz.ts`
- `extensions/md-log.ts`
- `extensions/visual-tools/`

### Visualization agents

The original `mermaid-maker` and `svg-maker` depend on custom Pi tools such as `write_mermaid`, `render_mermaid`, and Obsidian publishing behavior.

For the first Claude version, the `teach` skill emits small Mermaid code blocks directly when a structural diagram improves understanding.

A later version can add a Claude-native visualization workflow if there is a real need for rendered assets.

## How to use

Clone or check out this repository, then start Claude Code from the repository root:

```bash
claude
```

Try:

```text
Teach me what an agent harness is.
```

or invoke the skill explicitly:

```text
/teach explain MCP from first principles
```

For a time-sensitive topic, the main agent should delegate verification to `researcher` when appropriate. You can also request it explicitly:

```text
Use the researcher subagent to verify the current Claude Code subagent architecture, then teach it to me.
```

## Design principle

Keep the system understandable.

Do not add a new skill, agent, hook, or MCP merely because Claude Code supports it. Add one when it solves a repeated problem, then document what responsibility it owns.
