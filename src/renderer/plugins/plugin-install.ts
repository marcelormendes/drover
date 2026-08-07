import type { InstallPluginIntent } from '@/renderer/plugins/PluginCenter';

function quotePosixShellArgument(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildPluginInstallCommand(binary: string, intent: InstallPluginIntent) {
  const command = [
    quotePosixShellArgument(binary),
    'plugin',
    'install',
    quotePosixShellArgument(intent.source),
  ];
  if (intent.ref) {
    command.push('--ref', quotePosixShellArgument(intent.ref));
  }
  return command.join(' ');
}
