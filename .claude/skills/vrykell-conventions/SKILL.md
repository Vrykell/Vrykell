---
name: vrykell-conventions
description: MANDATORY reading before any change to Vrykell code, tests or docs - hard constraints, commands, shared components, testing, commit rules and definition of done. Always open this skill first; never write Vrykell code from memory of the project.
---

# vrykell-conventions (bridge)

Claude Code discovers skills under `.claude/skills/`, while Codex and Command Code read
`.agents/skills/`. The canonical skill lives at:

```
.agents/skills/vrykell-conventions/SKILL.md
```

That file is **mandatory reading in full before any change** - open it and follow it. Keep this
file's frontmatter identical to the canonical copy when its name or description changes, and do
not add rules here - edit the canonical file.
