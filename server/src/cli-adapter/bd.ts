import { safeExec } from './exec.js';
import type { BeadSummary } from './types.js';

export interface ListIssuesFilter {
  status?: string;
}

function parseBeadList(raw: string): BeadSummary[] {
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error(`bd list --json returned an unexpected shape (not an array): ${raw.slice(0, 200)}`);
  }
  return value as BeadSummary[];
}

export async function listIssues(filter: ListIssuesFilter = {}): Promise<BeadSummary[]> {
  const args = ['list', '--json'];
  if (filter.status) args.push(`--status=${filter.status}`);
  return parseBeadList(await safeExec('bd', args, { cwd: process.env.TOWN_ROOT || '/home/danny/gt' }));
}
