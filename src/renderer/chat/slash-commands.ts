export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  /** Commands that take an argument leave the composer with a trailing space. */
  readonly takesArgument?: boolean;
}

// Curated from the CLIs' own documentation: pi (coding-agent usage docs),
// Claude Code (code.claude.com commands reference), Codex CLI (OpenAI
// developer docs). The chat sends slash drafts as raw terminal input, so the
// lists only need to match what each CLI actually understands.
export const SLASH_COMMAND_SETS: Record<string, readonly SlashCommand[]> = {
  pi: [
    { name: 'help', description: 'Show available commands' },
    { name: 'model', description: 'Switch models', takesArgument: true },
    { name: 'compact', description: 'Compact the conversation context', takesArgument: true },
    { name: 'clear', description: 'Clear the conversation' },
    { name: 'new', description: 'Start a new session' },
    { name: 'resume', description: 'Pick from previous sessions' },
    { name: 'fork', description: 'Fork a session from a previous message' },
    { name: 'session', description: 'Show session file, ID, messages and cost' },
    { name: 'settings', description: 'Thinking level, theme and preferences' },
    { name: 'export', description: 'Export session to HTML or JSONL', takesArgument: true },
    { name: 'share', description: 'Share this session as a private gist link' },
    { name: 'hotkeys', description: 'Show all keyboard shortcuts' },
    { name: 'changelog', description: 'Display version history' },
    { name: 'quit', description: 'Quit pi' },
  ],
  codex: [
    { name: 'help', description: 'Show available commands' },
    { name: 'clear', description: 'Clear the conversation' },
    { name: 'compact', description: 'Summarize the conversation to free tokens' },
    { name: 'model', description: 'Choose the active model', takesArgument: true },
    { name: 'fast', description: 'Use a faster model' },
    { name: 'plan', description: 'Review and edit a plan before execution' },
    { name: 'review', description: 'Review the latest changes' },
    { name: 'init', description: 'Initialize Codex in this directory' },
    { name: 'agents', description: 'Manage subagents' },
    { name: 'status', description: 'Show session status and cost' },
    { name: 'cost', description: 'Show session cost' },
    { name: 'permissions', description: 'Change permission settings', takesArgument: true },
    { name: 'approve', description: 'Approve a retry after a review denial' },
    { name: 'personality', description: 'Change the assistant personality', takesArgument: true },
    { name: 'search', description: 'Toggle web search' },
    { name: 'login', description: 'Manage login' },
    { name: 'logout', description: 'Remove stored credentials' },
    { name: 'exit', description: 'Exit Codex' },
  ],
  claude: [
    { name: 'help', description: 'Show available commands' },
    { name: 'clear', description: 'Clear the conversation' },
    { name: 'compact', description: 'Compress the conversation', takesArgument: true },
    { name: 'context', description: 'Show context usage' },
    { name: 'model', description: 'Switch models', takesArgument: true },
    { name: 'effort', description: 'Adjust reasoning effort', takesArgument: true },
    { name: 'agents', description: 'Manage subagents and teams' },
    { name: 'memory', description: 'Manage memory', takesArgument: true },
    { name: 'mcp', description: 'Manage MCP servers', takesArgument: true },
    { name: 'permissions', description: 'Show and modify permissions' },
    { name: 'cost', description: 'Show session cost' },
    { name: 'usage', description: 'Show token usage' },
    { name: 'plan', description: 'Switch to plan mode' },
    { name: 'review', description: 'Review code changes' },
    { name: 'init', description: 'Initialize the project', takesArgument: true },
    { name: 'add-dir', description: 'Add a working directory', takesArgument: true },
    { name: 'rewind', description: 'Restore the conversation to a checkpoint' },
    { name: 'todo', description: 'Manage the todo list', takesArgument: true },
    { name: 'export', description: 'Export the conversation' },
    { name: 'status', description: 'Show session status' },
    { name: 'doctor', description: 'Diagnose installation issues' },
    { name: 'login', description: 'Manage authentication' },
    { name: 'logout', description: 'Sign out' },
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
