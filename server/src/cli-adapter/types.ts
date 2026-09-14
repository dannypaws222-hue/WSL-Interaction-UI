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
