# Lessons

- When using another product as a design reference, clearly separate verified reference behavior from proposed Herdr-specific enhancements before asking for approval.
- When the user delegates decisions to my recommendation, stop requesting approval for each design section and proceed autonomously through the agreed workflow.
- Never place Markdown backticks inside a shell command string used to send an agent prompt; the shell executes their contents. Use a safely single-quoted prompt without command-substitution syntax.
- Do not send repeated Ctrl-C keypresses to an interactive agent to interrupt one response; a second interrupt can exit the agent. Prefer one bounded interrupt, confirm state, and resume the recorded session if the process exits.
- When the user confirms an agent is working, trust the live agent state and keep monitoring; do not restart, switch models, or steer it based only on stale quota text or a mismatched secondary status endpoint.
- When an implementation agent reports completion after a destructive recovery, independently compare the remaining backlog, active runtime, regression-test count, and full gates before treating the source as restored; if the user asks me to take over, stop delegating and own the fixes through live verification.
- During visual chat QA, treat an expandable tool row with no useful payload as a product defect: verify the actual command/detail content, not only the absence of stray artifacts or empty disclosure controls.
- Never live-handoff, stop, replace, or start a server on the user's active Herdr config/socket while diagnosing or smoke-testing Chat, even if a previous handoff appeared successful. Use a separate `HERDR_CONFIG_PATH`, data directory, socket, and named test session; runtime mutation requires explicit user consent.
