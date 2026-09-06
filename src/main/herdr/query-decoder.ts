import type {
  AgentManifestInfo,
  HerdrQuery,
  HerdrQueryResult,
  InstalledPluginInfo,
  PluginActionContext,
  PluginActionInfo,
  PluginCommandDefinition,
  PluginManifestAction,
  PluginManifestEvent,
  PluginManifestLinkHandler,
  PluginManifestPane,
  PluginPlatform,
  PluginSourceInfo,
  WorktreeInfo,
  WorktreeSourceInfo,
} from '@/shared/desktop-api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isString) ? value : null;
}

function pluginPlatforms(value: unknown): PluginPlatform[] | null {
  return Array.isArray(value) &&
    value.every((item) => item === 'linux' || item === 'macos' || item === 'windows')
    ? value
    : null;
}

function pluginContexts(value: unknown): PluginActionContext[] | null {
  return Array.isArray(value) &&
    value.every(
      (item) =>
        item === 'global' ||
        item === 'workspace' ||
        item === 'tab' ||
        item === 'pane' ||
        item === 'selection',
    )
    ? value
    : null;
}

function popupSize(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65_535) ||
    (typeof value === 'string' && /^(100|[1-9][0-9]?)%$/.test(value))
  );
}

function decodePluginCommand(value: unknown): PluginCommandDefinition | null {
  if (!isRecord(value)) {
    return null;
  }
  const platforms = value.platforms === undefined ? undefined : pluginPlatforms(value.platforms);
  const command = stringArray(value.command);
  if (platforms === null || !command) {
    return null;
  }
  return { ...(platforms === undefined ? {} : { platforms }), command };
}

function decodeManifestAction(value: unknown): PluginManifestAction | null {
  const command = decodePluginCommand(value);
  if (
    !command ||
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.title) ||
    !isOptionalString(value.description)
  ) {
    return null;
  }
  const contexts = value.contexts === undefined ? [] : pluginContexts(value.contexts);
  if (!contexts) {
    return null;
  }
  return {
    ...command,
    id: value.id,
    title: value.title,
    ...(value.description === undefined ? {} : { description: value.description }),
    contexts,
  };
}

function decodeManifestEvent(value: unknown): PluginManifestEvent | null {
  const command = decodePluginCommand(value);
  return command && isRecord(value) && isString(value.on) ? { ...command, on: value.on } : null;
}

function decodeManifestPane(value: unknown): PluginManifestPane | null {
  const command = decodePluginCommand(value);
  if (
    !command ||
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.title) ||
    !isOptionalString(value.description) ||
    (value.placement !== undefined &&
      value.placement !== 'overlay' &&
      value.placement !== 'popup' &&
      value.placement !== 'split' &&
      value.placement !== 'tab' &&
      value.placement !== 'zoomed') ||
    (value.width !== undefined && !popupSize(value.width)) ||
    (value.height !== undefined && !popupSize(value.height))
  ) {
    return null;
  }
  return {
    ...command,
    id: value.id,
    title: value.title,
    ...(value.description === undefined ? {} : { description: value.description }),
    placement: value.placement ?? 'overlay',
    ...(value.width === undefined ? {} : { width: value.width as PluginManifestPane['width'] }),
    ...(value.height === undefined ? {} : { height: value.height as PluginManifestPane['height'] }),
  };
}

function decodeLinkHandler(value: unknown): PluginManifestLinkHandler | null {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.title) ||
    !isString(value.pattern) ||
    !isString(value.action)
  ) {
    return null;
  }
  const platforms = value.platforms === undefined ? undefined : pluginPlatforms(value.platforms);
  if (platforms === null) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    pattern: value.pattern,
    action: value.action,
    ...(platforms === undefined ? {} : { platforms }),
  };
}

function decodePluginSource(value: unknown): PluginSourceInfo | null {
  if (value === undefined) {
    return { kind: 'local' };
  }
  if (
    !isRecord(value) ||
    (value.kind !== undefined && value.kind !== 'local' && value.kind !== 'github') ||
    !isOptionalString(value.owner) ||
    !isOptionalString(value.repo) ||
    !isOptionalString(value.subdir) ||
    !isOptionalString(value.requested_ref) ||
    !isOptionalString(value.resolved_commit) ||
    !isOptionalString(value.managed_path) ||
    !isOptionalNumber(value.installed_unix_ms)
  ) {
    return null;
  }
  return {
    kind: value.kind ?? 'local',
    ...(value.owner === undefined ? {} : { owner: value.owner }),
    ...(value.repo === undefined ? {} : { repo: value.repo }),
    ...(value.subdir === undefined ? {} : { subdir: value.subdir }),
    ...(value.requested_ref === undefined ? {} : { requested_ref: value.requested_ref }),
    ...(value.resolved_commit === undefined ? {} : { resolved_commit: value.resolved_commit }),
    ...(value.managed_path === undefined ? {} : { managed_path: value.managed_path }),
    ...(value.installed_unix_ms === undefined
      ? {}
      : { installed_unix_ms: value.installed_unix_ms }),
  };
}

function decodeWorktreeSource(value: unknown): WorktreeSourceInfo | null {
  if (
    !isRecord(value) ||
    !isString(value.repo_key) ||
    !isString(value.repo_name) ||
    !isString(value.repo_root) ||
    !isString(value.source_checkout_path) ||
    !isOptionalString(value.source_workspace_id)
  ) {
    return null;
  }
  return {
    repo_key: value.repo_key,
    repo_name: value.repo_name,
    repo_root: value.repo_root,
    source_checkout_path: value.source_checkout_path,
    ...(value.source_workspace_id === undefined
      ? {}
      : { source_workspace_id: value.source_workspace_id }),
  };
}

function decodeWorktree(value: unknown): WorktreeInfo | null {
  if (
    !isRecord(value) ||
    !isString(value.path) ||
    !isOptionalString(value.branch) ||
    typeof value.is_bare !== 'boolean' ||
    typeof value.is_detached !== 'boolean' ||
    typeof value.is_prunable !== 'boolean' ||
    typeof value.is_linked_worktree !== 'boolean' ||
    !isOptionalString(value.open_workspace_id) ||
    !isString(value.label)
  ) {
    return null;
  }
  return {
    path: value.path,
    ...(value.branch === undefined ? {} : { branch: value.branch }),
    is_bare: value.is_bare,
    is_detached: value.is_detached,
    is_prunable: value.is_prunable,
    is_linked_worktree: value.is_linked_worktree,
    ...(value.open_workspace_id === undefined
      ? {}
      : { open_workspace_id: value.open_workspace_id }),
    label: value.label,
  };
}

function decodeManifest(value: unknown): AgentManifestInfo | null {
  if (
    !isRecord(value) ||
    !isString(value.agent) ||
    !isString(value.source) ||
    !isString(value.source_kind) ||
    !isOptionalString(value.active_version) ||
    !isOptionalString(value.cached_remote_version) ||
    typeof value.local_override_shadowing_remote !== 'boolean' ||
    !isOptionalString(value.remote_update_result) ||
    !isOptionalString(value.remote_update_error) ||
    !isOptionalNumber(value.remote_last_checked_unix) ||
    !isOptionalString(value.warning)
  ) {
    return null;
  }
  return {
    agent: value.agent,
    source: value.source,
    source_kind: value.source_kind,
    ...(value.active_version === undefined ? {} : { active_version: value.active_version }),
    ...(value.cached_remote_version === undefined
      ? {}
      : { cached_remote_version: value.cached_remote_version }),
    local_override_shadowing_remote: value.local_override_shadowing_remote,
    ...(value.remote_update_result === undefined
      ? {}
      : { remote_update_result: value.remote_update_result }),
    ...(value.remote_update_error === undefined
      ? {}
      : { remote_update_error: value.remote_update_error }),
    ...(value.remote_last_checked_unix === undefined
      ? {}
      : { remote_last_checked_unix: value.remote_last_checked_unix }),
    ...(value.warning === undefined ? {} : { warning: value.warning }),
  };
}

function decodePlugin(value: unknown): InstalledPluginInfo | null {
  if (
    !isRecord(value) ||
    !isString(value.plugin_id) ||
    !isString(value.name) ||
    !isString(value.version) ||
    !isString(value.min_herdr_version) ||
    !isOptionalString(value.description) ||
    !isString(value.manifest_path) ||
    !isString(value.plugin_root) ||
    typeof value.enabled !== 'boolean'
  ) {
    return null;
  }
  const platforms = value.platforms === undefined ? undefined : pluginPlatforms(value.platforms);
  const build = decodeItems(value.build ?? [], decodePluginCommand);
  const startup = decodeItems(value.startup ?? [], decodePluginCommand);
  const actions = decodeItems(value.actions ?? [], decodeManifestAction);
  const events = decodeItems(value.events ?? [], decodeManifestEvent);
  const panes = decodeItems(value.panes ?? [], decodeManifestPane);
  const linkHandlers = decodeItems(value.link_handlers ?? [], decodeLinkHandler);
  const source = decodePluginSource(value.source);
  const warnings = value.warnings === undefined ? [] : stringArray(value.warnings);
  if (
    platforms === null ||
    !build ||
    !startup ||
    !actions ||
    !events ||
    !panes ||
    !linkHandlers ||
    !source ||
    warnings === null
  ) {
    return null;
  }
  return {
    plugin_id: value.plugin_id,
    name: value.name,
    version: value.version,
    min_herdr_version: value.min_herdr_version,
    ...(value.description === undefined ? {} : { description: value.description }),
    manifest_path: value.manifest_path,
    plugin_root: value.plugin_root,
    enabled: value.enabled,
    ...(platforms === undefined ? {} : { platforms }),
    build,
    startup,
    actions,
    events,
    panes,
    link_handlers: linkHandlers,
    source,
    warnings,
  };
}

function decodeAction(value: unknown): PluginActionInfo | null {
  if (
    !isRecord(value) ||
    !isString(value.plugin_id) ||
    !isString(value.action_id) ||
    !isString(value.title) ||
    !isOptionalString(value.description)
  ) {
    return null;
  }
  const contexts = value.contexts === undefined ? [] : pluginContexts(value.contexts);
  const command = stringArray(value.command);
  const platforms = value.platforms === undefined ? undefined : pluginPlatforms(value.platforms);
  if (!contexts || !command || platforms === null) {
    return null;
  }
  return {
    plugin_id: value.plugin_id,
    action_id: value.action_id,
    title: value.title,
    ...(value.description === undefined ? {} : { description: value.description }),
    contexts,
    command,
    ...(platforms === undefined ? {} : { platforms }),
  };
}

function decodeItems<T>(value: unknown, decoder: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: T[] = [];
  for (const item of value) {
    const decoded = decoder(item);
    if (!decoded) {
      return null;
    }
    result.push(decoded);
  }
  return result;
}

function invalid(name: string): never {
  throw new Error(`Herdr returned an invalid ${name} response.`);
}

export function decodeHerdrQueryResult(query: HerdrQuery, value: unknown): HerdrQueryResult {
  switch (query.type) {
    case 'read-pane-output': {
      if (!isRecord(value) || value.type !== 'pane_read' || !isRecord(value.read)) {
        return invalid('pane output');
      }
      const read = value.read;
      if (
        !isString(read.pane_id) ||
        !isString(read.workspace_id) ||
        !isString(read.tab_id) ||
        read.source !== (query.source ?? 'recent_unwrapped') ||
        (read.format !== 'text' && read.format !== 'ansi') ||
        !isString(read.text) ||
        typeof read.revision !== 'number' ||
        !Number.isSafeInteger(read.revision) ||
        read.revision < 0 ||
        typeof read.truncated !== 'boolean'
      ) {
        return invalid('pane output');
      }
      return {
        type: 'pane-output',
        paneId: read.pane_id,
        workspaceId: read.workspace_id,
        tabId: read.tab_id,
        text: read.text,
        revision: read.revision,
        truncated: read.truncated,
      };
    }
    case 'list-worktrees': {
      if (!isRecord(value) || value.type !== 'worktree_list') {
        return invalid('worktree list');
      }
      const source = decodeWorktreeSource(value.source);
      const worktrees = decodeItems(value.worktrees, decodeWorktree);
      if (!source || !worktrees) {
        return invalid('worktree list');
      }
      return { type: 'worktree-list', source, worktrees };
    }
    case 'get-agent-manifests': {
      if (
        !isRecord(value) ||
        value.type !== 'agent_manifest_status' ||
        !isOptionalNumber(value.last_check_unix) ||
        !isOptionalString(value.last_result)
      ) {
        return invalid('agent manifest status');
      }
      const manifests = decodeItems(value.manifests, decodeManifest);
      if (!manifests) {
        return invalid('agent manifest status');
      }
      return {
        type: 'agent-manifests',
        ...(value.last_check_unix === undefined ? {} : { last_check_unix: value.last_check_unix }),
        ...(value.last_result === undefined ? {} : { last_result: value.last_result }),
        manifests,
      };
    }
    case 'list-plugins': {
      if (!isRecord(value) || value.type !== 'plugin_list') {
        return invalid('plugin list');
      }
      const plugins = decodeItems(value.plugins, decodePlugin);
      if (!plugins) {
        return invalid('plugin list');
      }
      return { type: 'plugin-list', plugins };
    }
    case 'list-plugin-actions': {
      if (!isRecord(value) || value.type !== 'plugin_action_list') {
        return invalid('plugin action list');
      }
      const actions = decodeItems(value.actions, decodeAction);
      if (!actions) {
        return invalid('plugin action list');
      }
      return { type: 'plugin-action-list', actions };
    }
  }
}
