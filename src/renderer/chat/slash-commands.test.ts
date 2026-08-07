import { describe, expect, it } from 'vitest';

import {
  filterSlashCommands,
  SLASH_COMMAND_SETS,
  slashCommandsForAgent,
} from '@/renderer/chat/slash-commands';

describe('slashCommandsForAgent', () => {
  it('curates commands for pi, codex, and claude', () => {
    for (const agent of ['pi', 'codex', 'claude']) {
      const commands = slashCommandsForAgent(agent);
      expect(commands.length).toBeGreaterThan(8);
      const names = new Set(commands.map((command) => command.name));
      expect(names.size).toBe(commands.length);
      for (const command of commands) {
        expect(command.name).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(command.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('covers the three named agents and nothing else', () => {
    expect(Object.keys(SLASH_COMMAND_SETS).sort()).toEqual(['claude', 'codex', 'pi']);
  });

  it('lists exactly the commands the installed pi 0.83 binary registers', () => {
    // Verified against the installed pi package's slash-commands module; pi
    // has no /help or /clear — those would fall through as ordinary prompts.
    expect(
      slashCommandsForAgent('pi')
        .map((command) => command.name)
        .sort(),
    ).toEqual([
      'changelog',
      'clone',
      'compact',
      'copy',
      'export',
      'fork',
      'hotkeys',
      'import',
      'login',
      'logout',
      'model',
      'name',
      'new',
      'quit',
      'reload',
      'resume',
      'scoped-models',
      'session',
      'settings',
      'share',
      'tree',
      'trust',
    ]);
  });

  it('advertises current documented codex commands without stale entries', () => {
    const codex = new Set(slashCommandsForAgent('codex').map((command) => command.name));
    for (const name of [
      'clear',
      'compact',
      'model',
      'fast',
      'plan',
      'review',
      'init',
      'agent',
      'permissions',
      'approve',
      'status',
      'usage',
      'mcp',
      'resume',
      'new',
      'fork',
      'logout',
      'exit',
    ]) {
      expect(codex.has(name)).toBe(true);
    }
    for (const name of ['help', 'agents', 'cost', 'search', 'login']) {
      expect(codex.has(name)).toBe(false);
    }
  });

  it('advertises current documented claude commands without stale entries', () => {
    const claude = new Set(slashCommandsForAgent('claude').map((command) => command.name));
    for (const name of [
      'help',
      'clear',
      'compact',
      'context',
      'model',
      'effort',
      'agents',
      'memory',
      'mcp',
      'permissions',
      'usage',
      'plan',
      'review',
      'init',
      'add-dir',
      'rewind',
      'resume',
      'fork',
      'diff',
      'tasks',
      'export',
      'doctor',
      'login',
      'logout',
      'quit',
    ]) {
      expect(claude.has(name)).toBe(true);
    }
    for (const name of ['setcwd', 'todo']) {
      expect(claude.has(name)).toBe(false);
    }
  });

  it('does not advertise commands the installed CLIs do not implement', () => {
    const pi = new Set(slashCommandsForAgent('pi').map((command) => command.name));
    expect(pi.has('help')).toBe(false);
    expect(pi.has('clear')).toBe(false);
    expect(pi.has('agents')).toBe(false);
    expect(pi.has('memory')).toBe(false);
  });

  it('falls back to a generic set for unknown agents', () => {
    const fallback = slashCommandsForAgent('other-agent');
    const names = fallback.map((command) => command.name);
    expect(names).toContain('help');
    expect(names).toContain('compact');
    expect(names).toContain('model');
  });

  it('marks argument-taking commands so the composer can leave room for input', () => {
    const claude = slashCommandsForAgent('claude');
    const model = claude.find((command) => command.name === 'model');
    expect(model?.takesArgument).toBe(true);
    const clear = claude.find((command) => command.name === 'clear');
    expect(clear?.takesArgument).toBeFalsy();

    const pi = slashCommandsForAgent('pi');
    expect(pi.find((command) => command.name === 'login')?.takesArgument).toBe(true);
  });
});

describe('filterSlashCommands', () => {
  const commands = slashCommandsForAgent('codex');

  it('returns the full list for an empty query', () => {
    expect(filterSlashCommands(commands, '')).toHaveLength(commands.length);
    expect(filterSlashCommands(commands, '/')).toHaveLength(commands.length);
  });

  it('matches by name prefix', () => {
    const names = filterSlashCommands(commands, 'co').map((command) => command.name);
    expect(names).toContain('compact');
    expect(names).toContain('copy');
    expect(names).not.toContain('model');
  });

  it('matches by name substring and description', () => {
    expect(filterSlashCommands(commands, 't').map((command) => command.name)).toContain('status');
    const byDescription = filterSlashCommands(commands, 'credentials');
    expect(byDescription.map((command) => command.name)).toContain('logout');
  });

  it('is case insensitive', () => {
    const names = filterSlashCommands(commands, 'MO').map((command) => command.name);
    expect(names).toContain('model');
  });

  it('returns nothing when nothing matches', () => {
    expect(filterSlashCommands(commands, 'zzzz')).toEqual([]);
  });
});
