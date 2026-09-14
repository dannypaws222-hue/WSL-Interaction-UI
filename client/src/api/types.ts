export interface PollSnapshot<T> {
  data: T | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  isStale: boolean;
}

export interface HookStatus {
  target: string;
  role: string;
  agent_bead_id: string;
  has_work: boolean;
  is_wisp: boolean;
  next_action: string;
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  timestamp: string;
  read: boolean;
  priority: string;
  type: string;
}

export interface RigSummary {
  name: string;
  beads_prefix: string;
  status: string;
  witness: string;
  refinery: string;
  polecats: number;
  crew: number;
}

export interface BeadSummary {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
}

export interface AgentSummary {
  name: string;
  address: string;
  session: string;
  role: string;
  rig: string | null;
  running: boolean;
  state: string;
  hasWork: boolean;
}

export interface PaneResponse {
  session: string;
  pane: string;
  capturedAt: number;
}

export type SnapshotMessage =
  | { type: 'snapshot'; resource: 'hook'; snapshot: PollSnapshot<HookStatus> }
  | { type: 'snapshot'; resource: 'mail'; snapshot: PollSnapshot<MailMessage[]> }
  | { type: 'snapshot'; resource: 'rigs'; snapshot: PollSnapshot<RigSummary[]> }
  | { type: 'snapshot'; resource: 'beads'; snapshot: PollSnapshot<BeadSummary[]> }
  | { type: 'snapshot'; resource: 'agents'; snapshot: PollSnapshot<AgentSummary[]> };
