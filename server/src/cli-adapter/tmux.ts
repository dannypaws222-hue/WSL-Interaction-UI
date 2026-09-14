import { safeExec } from './exec.js';

async function getTmuxSocketPath(): Promise<string> {
  const raw = JSON.parse(await safeExec('gt', ['status', '--json']));
  const socketPath = raw?.tmux?.socket_path;
  if (typeof socketPath !== 'string' || socketPath.length === 0) {
    throw new Error('gt status --json is missing tmux.socket_path');
  }
  return socketPath;
}

export async function capturePane(session: string, lines = 50): Promise<string> {
  const socketPath = await getTmuxSocketPath();
  return safeExec('tmux', ['-S', socketPath, 'capture-pane', '-t', session, '-p', '-S', `-${lines}`]);
}
