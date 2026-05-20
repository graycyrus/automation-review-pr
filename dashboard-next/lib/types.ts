// Shared types for the dashboard frontend. Mirrors the shape returned by the
// API routes in app/api/**.

export type PrStatus =
  | 'under-review'
  | 'changes-requested'
  | 'clean'
  | 'approved'
  | 'blocked'
  | 'pending'
  | 'merged'
  | 'closed';

export interface ReviewCycle {
  id: number;
  pr_id: number;
  cycle_number: number;
  type?: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  commit_sha?: string;
  summary?: string;
  gates?: string;
  areas_changed?: string;
  findings_critical?: number;
  findings_major?: number;
  findings_minor?: number;
  action_taken?: string;
  github_review_url?: string;
  coderabbit_dedup?: string;
  resolution_actions?: string;
  log_file_path?: string;
  reviewer?: string;
}

export interface Pr {
  id: number;
  title?: string;
  author?: string;
  branch?: string;
  base_branch?: string;
  url?: string;
  created_at?: string;
  status?: PrStatus | string;
  is_draft?: number;
  gh_is_draft?: number;
  is_member?: number;
  last_reviewed_commit?: string;
  last_review_date?: string;
  tracking_file_path?: string;
  location?: string;
  review_decision?: string;
  mergeable?: string;
  merge_state_status?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  labels?: string;
  reviewers?: string;
  assignees?: string;
  updated_at_gh?: string;
  is_open?: number;
  ci_checks?: string;
  ci_total?: number;
  ci_pass?: number;
  ci_fail?: number;
  ci_pending?: number;
  latest_cycle?: number;
  cycle_status?: string;
  findings_critical?: number;
  findings_major?: number;
  findings_minor?: number;
  action_taken?: string;
  cycles?: ReviewCycle[];
  is_running?: boolean;
  is_fixing?: boolean;
  tmux_window?: string | null;
  tmux_fix_window?: string | null;
  tmux_exit_code?: number | null;
}

export interface Stats {
  total: number;
  drafts: number;
  under_review: number;
  changes_requested: number;
  clean: number;
  blocked: number;
  pending: number;
  merged: number;
  closed: number;
  liveStatus?: { running?: boolean; pr?: number } | null;
}

export interface FilterOptions {
  authors: string[];
  statuses: string[];
  labels: string[];
  mergeStates: string[];
}

export interface CiCheck {
  name: string;
  bucket: string;
  workflow?: string;
  startedAt?: string;
  completedAt?: string;
  link?: string;
}

export interface Job {
  pid: number;
  pr?: number | null;
  type: 'review' | 'discover';
  startedAt: string;
  endedAt?: string | null;
  done: boolean;
  exitCode: number | null;
  lineCount: number;
}

// GitHub API (public) shapes — only the fields we read
export interface GhPr {
  body: string | null;
  title: string;
  state: string;
  user: { login: string };
  html_url: string;
  changed_files: number;
  additions: number;
  deletions: number;
}

export interface GhFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | string;
  additions: number;
  deletions: number;
  blob_url?: string;
}

export interface GhComment {
  id: number;
  user: { login: string } | null;
  body: string;
  created_at: string;
  html_url: string;
  path?: string;
  line?: number | null;
  kind: 'issue' | 'review';
}

export interface PrFilters {
  status?: string;
  author?: string;
  member?: string;
  draft?: string;
  mergeable?: string;
  review_decision?: string;
  label?: string;
  has_review?: string;
  has_findings?: string;
  merge_state?: string;
  is_open?: string;
  assignee?: string;
  reviewer?: string;
  search?: string;
  ci_status?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  include_merged?: string | boolean;
}
