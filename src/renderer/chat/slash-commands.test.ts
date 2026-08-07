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

  it('includes the core session commands for every agent', () => {
    for (const agent of ['pi', 'codex', 'claude']) {
      const names = new Set(slashCommandsForAgent(agent).map((command) => command.name));
      expect(names.has('model')).toBe(true);
      expect(names.has('compact')).toBe(true);
      expect(names.has('clear')).toBe(true);
      expect(names.has('help')).toBe(true);
    }
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
    expect(names).toContain('cost');
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
