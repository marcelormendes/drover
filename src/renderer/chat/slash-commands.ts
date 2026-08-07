export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  /** Commands that take an argument leave the composer with a trailing space. */
  readonly takesArgument?: boolean;
}

// Curated from each CLI's own sources: the installed pi 0.83 package's
// slash-commands module, the current Claude Code commands reference, and the
// current Codex CLI slash-commands documentation. The chat sends slash drafts
// as raw terminal input, so the lists only include commands each CLI actually
// implements — pi notably has no /help or /clear (they would fall through as
// ordinary prompts).
export const SLASH_COMMAND_SETS: Record<string, readonly SlashCommand[]> = {
  pi: [
    { name: 'settings', description: 'Open settings menu' },
    { name: 'model', description: 'Select model (opens selector UI)', takesArgument: true },
    { name: 'scoped-models', description: 'Enable/disable models for Ctrl+P cycling' },
    { name: 'compact', description: 'Manually compact the session context', takesArgument: true },
    { name: 'new', description: 'Start a new session' },
    { name: 'resume', description: 'Resume a different session' },
    { name: 'fork', description: 'Create a new fork from a previous user message' },
    { name: 'clone', description: 'Duplicate the current session at the current position' },
    { name: 'tree', description: 'Navigate session tree (switch branches)' },
    { name: 'session', description: 'Show session info and stats' },
    { name: 'name', description: 'Set session display name', takesArgument: true },
    { name: 'copy', description: 'Copy last agent message to clipboard' },
    { name: 'export', description: 'Export session to HTML or JSONL', takesArgument: true },
    {
      name: 'import',
      description: 'Import and resume a session from a JSONL file',
      takesArgument: true,
    },
    { name: 'share', description: 'Share session as a secret GitHub gist' },
    {
      name: 'reload',
      description: 'Reload keybindings, extensions, skills, prompts, themes, and context files',
    },
    { name: 'hotkeys', description: 'Show all keyboard shortcuts' },
    { name: 'changelog', description: 'Show changelog entries' },
    { name: 'trust', description: 'Save project trust decision for future sessions' },
    { name: 'login', description: 'Configure provider authentication', takesArgument: true },
    { name: 'logout', description: 'Remove provider authentication' },
    { name: 'quit', description: 'Quit pi' },
  ],
  codex: [
    { name: 'clear', description: 'Clear the terminal and start a fresh chat' },
    { name: 'new', description: 'Start a new chat' },
    { name: 'resume', description: 'Resume a saved chat' },
    { name: 'fork', description: 'Fork the current chat into a new chat' },
    { name: 'compact', description: 'Summarize the visible chat to free tokens' },
    { name: 'model', description: 'Choose the active model', takesArgument: true },
    { name: 'fast', description: "Toggle the current model's fast service tier" },
    { name: 'plan', description: 'Switch to plan mode', takesArgument: true },
    { name: 'review', description: 'Review the latest changes', takesArgument: true },
    { name: 'init', description: 'Initialize Codex in this directory' },
    { name: 'agent', description: 'Switch the active agent thread' },
    { name: 'subagents', description: 'Switch the active agent thread' },
    { name: 'status', description: 'Show session configuration and token usage' },
    { name: 'usage', description: 'View account token usage' },
    { name: 'permissions', description: 'Set what Codex can do without asking' },
    { name: 'approve', description: 'Approve one retry of a recent review denial' },
    { name: 'personality', description: 'Choose a communication style', takesArgument: true },
    { name: 'raw', description: 'Toggle raw scrollback mode' },
    { name: 'diff', description: 'Inspect the git diff' },
    { name: 'mcp', description: 'List configured MCP tools' },
    { name: 'memories', description: 'Configure memory use and generation' },
    { name: 'skills', description: 'Browse and use skills' },
    { name: 'goal', description: 'Set, edit, pause, resume, view, or clear a task goal' },
    { name: 'copy', description: 'Copy the latest completed response' },
    { name: 'archive', description: 'Archive the current session and exit' },
    { name: 'delete', description: 'Permanently delete the current session and exit' },
    { name: 'feedback', description: 'Send feedback and optional logs' },
    { name: 'logout', description: 'Remove stored credentials' },
    { name: 'exit', description: 'Exit Codex' },
    { name: 'quit', description: 'Exit Codex' },
  ],
  claude: [
    { name: 'help', description: 'Show available commands' },
    { name: 'clear', description: 'Start a new conversation with empty context' },
    {
      name: 'compact',
      description: 'Free up context by summarizing the conversation',
      takesArgument: true,
    },
    { name: 'context', description: 'Show context usage' },
    { name: 'model', description: 'Switch models', takesArgument: true },
    { name: 'effort', description: 'Adjust reasoning effort', takesArgument: true },
    { name: 'agents', description: 'Manage subagents and agent teams' },
    { name: 'memory', description: 'Manage memory', takesArgument: true },
    { name: 'mcp', description: 'Manage MCP servers', takesArgument: true },
    { name: 'permissions', description: 'Show and modify permissions' },
    { name: 'cost', description: 'Show session cost' },
    { name: 'usage', description: 'Show token usage' },
    { name: 'plan', description: 'Switch to plan mode', takesArgument: true },
    { name: 'review', description: 'Review the current diff', takesArgument: true },
    { name: 'init', description: 'Initialize the project' },
    { name: 'add-dir', description: 'Add a working directory', takesArgument: true },
    { name: 'rewind', description: 'Restore the conversation to a checkpoint' },
    { name: 'resume', description: 'Resume a previous conversation', takesArgument: true },
    {
      name: 'fork',
      description: 'Copy the conversation into a background session',
      takesArgument: true,
    },
    { name: 'diff', description: 'Show uncommitted changes and per-turn diffs' },
    { name: 'tasks', description: 'List background tasks and subagents' },
    { name: 'export', description: 'Export the conversation', takesArgument: true },
    { name: 'status', description: 'Show session status' },
    { name: 'doctor', description: 'Diagnose installation issues' },
    { name: 'feedback', description: 'Send product feedback', takesArgument: true },
    { name: 'login', description: 'Manage authentication' },
    { name: 'logout', description: 'Sign out' },
    { name: 'exit', description: 'Exit Claude Code' },
    { name: 'quit', description: 'Exit Claude Code' },
  ],
};

export const FALLBACK_SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'help', description: 'Show available commands' },
  { name: 'clear', description: 'Clear the conversation' },
  { name: 'compact', description: 'Compact the conversation context' },
  { name: 'model', description: 'Switch models', takesArgument: true },
  { name: 'status', description: 'Show session status' },
  { name: 'cost', description: 'Show session cost' },
  { name: 'quit', description: 'Quit the agent' },
];

export function slashCommandsForAgent(agent: string): readonly SlashCommand[] {
  return SLASH_COMMAND_SETS[agent] ?? FALLBACK_SLASH_COMMANDS;
}

/**
 * Filters commands by the text typed after the leading slash. Name prefix
 * matches win over substring and description matches, mirroring the CLIs'
 * own command menus.
 */
export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
): readonly SlashCommand[] {
  const needle = query.replace(/^\//, '').trim().toLowerCase();
  if (!needle) {
    return commands;
  }
  const prefixMatches: SlashCommand[] = [];
  const otherMatches: SlashCommand[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) {
      prefixMatches.push(command);
    } else if (name.includes(needle) || command.description.toLowerCase().includes(needle)) {
      otherMatches.push(command);
    }
  }
  return [...prefixMatches, ...otherMatches];
}
