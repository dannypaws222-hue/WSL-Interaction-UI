import { safeExec } from './exec.js';

let cachedSocketPath: string | null = null;

async function getTmuxSocketPath(): Promise<string> {
  if (cachedSocketPath) return cachedSocketPath;
  const raw = JSON.parse(await safeExec('gt', ['status', '--json']));
  const socketPath = raw?.tmux?.socket_path;
  if (typeof socketPath !== 'string' || socketPath.length === 0) {
    throw new Error('gt status --json is missing tmux.socket_path');
  }
  cachedSocketPath = socketPath;
  return socketPath;
}

export async function capturePane(session: string, lines = 50): Promise<string> {
  const socketPath = await getTmuxSocketPath();
  try {
    return await safeExec('tmux', ['-S', socketPath, 'capture-pane', '-t', session, '-p', '-S', `-${lines}`]);
  } catch (err) {
    cachedSocketPath = null; // socket may be stale; re-discover on the next call
    throw err;
  }
}
