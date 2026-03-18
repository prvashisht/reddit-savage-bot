export type RunResult = 'posted' | 'skipped' | 'failed' | 'dry_run' | 'comment_added' | 'comment_skipped';
export type CommentResult = 'posted' | 'failed' | 'skipped';

export type FlairResult =
  | { status: 'set'; party: string; person: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

export type LogLevel = 'log' | 'warn' | 'error';
export type LogEntry = { level: LogLevel; msg: string; ts: string };

export type RunState = {
  lastRunAt: string;
  lastRunResult: RunResult;
  lastPostedTitle?: string;
  lastPostedUrl?: string;
  lastError?: string;
  commentResult?: CommentResult;
  flairResult?: FlairResult;
  source?: 'scheduled' | 'manual';
  logs?: LogEntry[];
};

const HISTORY_KEY = 'run_history';
const MAX_HISTORY = 20;

export async function getRunHistory(kv: KVNamespace): Promise<RunState[]> {
  return (await kv.get<RunState[]>(HISTORY_KEY, 'json')) ?? [];
}

export async function getRunState(kv: KVNamespace): Promise<RunState | null> {
  const history = await getRunHistory(kv);
  return history[0] ?? null;
}

export async function putRunState(kv: KVNamespace, state: RunState): Promise<void> {
  const history = await getRunHistory(kv);
  history.unshift(state);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await kv.put(HISTORY_KEY, JSON.stringify(history));
}
