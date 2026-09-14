import { safeExec } from './exec.js';
import type { HookStatus, MailMessage, RigSummary } from './types.js';

function parseHookStatus(raw: string): HookStatus {
  const value = JSON.parse(raw);
  if (
    typeof value !== 'object' || value === null ||
    typeof value.role !== 'string' || typeof value.has_work !== 'boolean'
  ) {
    throw new Error(`gt hook --json returned an unexpected shape: ${raw.slice(0, 200)}`);
  }
  return value as HookStatus;
}

function parseMailInbox(raw: string): MailMessage[] {
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error(`gt mail inbox --json returned an unexpected shape (not an array): ${raw.slice(0, 200)}`);
  }
  return value as MailMessage[];
}

function parseRigList(raw: string): RigSummary[] {
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error(`gt rig list --json returned an unexpected shape (not an array): ${raw.slice(0, 200)}`);
  }
  return value as RigSummary[];
}

export async function getHook(): Promise<HookStatus> {
  return parseHookStatus(await safeExec('gt', ['hook', '--json']));
}

export async function getMailInbox(): Promise<MailMessage[]> {
  return parseMailInbox(await safeExec('gt', ['mail', 'inbox', '--json']));
}

export async function getRigList(): Promise<RigSummary[]> {
  return parseRigList(await safeExec('gt', ['rig', 'list', '--json']));
}
