import { execFile } from 'node:child_process';

export interface SafeExecOptions {
  timeoutMs?: number;
  maxBufferBytes?: number;
  cwd?: string;
}

export class SafeExecError extends Error {
  constructor(
    message: string,
    public readonly code: 'TIMEOUT' | 'NONZERO_EXIT' | 'OUTPUT_TOO_LARGE' | 'SPAWN_ERROR',
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'SafeExecError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 5 * 1024 * 1024;

export function safeExec(
  command: string,
  args: string[],
  options: SafeExecOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer, cwd: options.cwd },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          if (err.killed && err.signal === 'SIGTERM') {
            reject(new SafeExecError(
              `Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`,
              'TIMEOUT',
              stderr
            ));
            return;
          }
          if (err.code === 'ENOBUFS' || /maxBuffer/.test(err.message)) {
            reject(new SafeExecError(
              `Command output exceeded ${maxBuffer} bytes: ${command} ${args.join(' ')}`,
              'OUTPUT_TOO_LARGE',
              stderr
            ));
            return;
          }
          if (typeof err.code === 'number') {
            reject(new SafeExecError(
              `Command exited with code ${err.code}: ${command} ${args.join(' ')}`,
              'NONZERO_EXIT',
              stderr
            ));
            return;
          }
          reject(new SafeExecError(`Failed to spawn command: ${command}`, 'SPAWN_ERROR', stderr));
          return;
        }
        resolve(stdout);
      }
    );
  });
}
