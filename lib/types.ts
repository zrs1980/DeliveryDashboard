// ─── NetSuite Project ─────────────────────────────────────────────────────────

export interface NSProject {
  id: number;
  entityid: string;           // project number e.g. "406"
  companyname: string;        // client name
  startdate: string | null;
  golive_date: string | null; // custentity_project_golive_date
  entitystatus: number;
  jobtype: number;            // 1 = Implementation, 2 = Service
  clickup_url: string | null; // custentity20
  budget_hours: number;       // custentity_ceba_project_budget_hours
  remaining_hours: number;    // custentity_project_remaining_hours
}

// ─── Project Note ─────────────────────────────────────────────────────────────

export interface ProjectNote {
  id: string;       // timestamp-based unique id
  text: string;
  author: string;
  ts: string;       // ISO datetime string
}

// ─── ClickUp Task ─────────────────────────────────────────────────────────────

export interface CUTask {
  id: string;
  name: string;
  status: { status: string; color: string };
  due_date: string | null;    // Unix ms timestamp as string
  assignees: { id: number; username: string; color: string }[];
  tags: { name: string }[];
  time_estimate: number | null; // ms
  time_spent: number | null;    // ms
  url: string;
  list: { id: string; name: string };
}

// ─── Derived Project (enriched with ClickUp + health) ────────────────────────

export interface Project {
  id: number;
  entityid: string;
  label: string;              // "Client — Project Name"
  client: string;
  projectType: "Implementation" | "Service";
  pm: string;
  goliveDate: string | null;
  daysLeft: number | null;
  isOverdue: boolean;
  budget_hours: number;
  actual: number;             // hours consumed = budget - remaining
  rem: number;                // remaining hours
  pct: number;                // 0–1 completion from ClickUp tasks
  burnRate: number;
  spi: number;
  budgetGap: number;
  score: number;
  health: "green" | "yellow" | "red";
  nsUrl: string;
  clickupUrl: string | null;
  clickupListId: string | null;
  tasks: CUTask[];
  blocked: CUTask[];
  clientPending: CUTask[];
  milestones: CUTask[];
  timebillWarning: boolean;   // remaining_hours drift flag
  notes: ProjectNote[];
}

// ─── Phase (projecttask) ─────────────────────────────────────────────────────

export interface ProjectPhase {
  phaseId: number;
  projectId: number;
  projectNumber: string;
  client: string;
  phaseName: string;
  phaseStart: string | null;
  phaseEnd: string | null;
  budgetedHours: number;
  actualHours: number;
  remainingHours: number;
  pctComplete: number;
  phaseStatus: string;
  timelineRAG: "green" | "yellow" | "red" | "grey";
  budgetRAG: "green" | "yellow" | "red" | "grey";
}

// ─── Resource Allocation ──────────────────────────────────────────────────────

export interface TimebillRow {
  employee: number;
  project_id: number;
  total_hours: number;
}

export interface WeeklyAllocation {
  consultant: string;
  employeeId: number;
  weeks: Record<string, number>; // ISO week start (Mon) → hours
  byProject: Record<number, Record<string, number>>;
}
