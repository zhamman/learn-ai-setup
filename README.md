# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

My AI learning system from this video: [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU).

This is a personal system I built for myself, shared as-is. Built as a pi configuration: the teaching philosophy encoded in a skill, a few small extensions, and agent definitions.

## What's in it

- `skills/teach/` — the philosophy and the process
- `skills/visualize/` — adds a correct, minimal diagram to a lesson when an idea is clearer as a picture
- `extensions/ask-user-question/` — the agent asks you questions through a UI popup
- `extensions/quiz/` — graded questions with instant feedback (✓/✗, correct answer, explanation)
- `extensions/md-log/` — link a markdown file to the session
- `extensions/visual-tools/` — tools for visualization subagents
- `agents/` — `researcher`, `repo-researcher`, `svg-maker`, `mermaid-maker`: the subagents the system delegates to

`repo-researcher` is a read-only local-repository reconnaissance worker. For medium/large repos, the teacher can delegate a few non-overlapping subsystem scans, receive compressed architecture briefs, and keep raw source out of the main teaching context until a lesson actually needs it.

## Install

This repo **is** a `.pi` directory. From your learning project's root:

```bash
git clone https://github.com/amosblomqvist/learn .pi
```

Then open pi in that directory. (Or copy the pieces you want into your existing project config.)

## Requirements

- [pi](https://github.com/earendil-works/pi)
- One subagent implementation that matches the terminal environment where Pi runs:
  - **Herdr:** `pi install npm:pi-herdr-subagents`
  - **tmux/cmux/zellij/WezTerm:** `pi install git:github.com/HazAT/pi-interactive-subagents`
  Use one implementation for the active environment; both expose the `subagent` workflow used by these agent definitions.
- `ask-user-question` — use the copy bundled here. If your setup already has an `ask-user-question` extension, use **this** one in its place. Popups from different extensions serialize through a shared UI lock, which only works when it's the same implementation.

`agents/researcher.md` includes `safe_bash`, which comes from the interactive-subagent setup this project was originally built around. If a different implementation does not provide that tool, adapt that agent definition. `repo-researcher` intentionally avoids bash entirely and uses only `read`, `grep`, `find`, and `ls`.

## Notes

You can run the system without subagents. The main session does the teaching. You just lose web-research verification, repo-reconnaissance compression for large codebases, and generated visuals.

The teaching skill is written for one learner (me). Edit the skill to fit how you learn best.
