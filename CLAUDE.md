@AGENTS.md

When working in this repo:

- Always run unit tests before finishing tasks
- Prefer small incremental commits
- Use existing utils instead of creating new ones
- Explain changes briefly in commit messages
- Update the "memory.md" after finishing commit/ task
- Document the "what and why" of each change before committing
- Group related files into one commit; split unrelated changes into separate commits
- Commit messages must be specific and informative (e.g., "fix: remove tracked local config files" not "cleanup")
- Ask before executing anything uncertain, destructive, security-sensitive, or deployment-affecting:
  * rewriting git history
  * force-pushing
  * deleting files or tracked git objects
  * switching or modifying branches beyond the current task
  * changing configuration behavior or deployment-related files
  * modifying security-related logic or adding new dependencies