import type { TaskStage } from './mock-data.js';

/** A stage's own status, translated into the same done/current/pending
    rail-modifier vocabulary `.task-stepper__step--*` already uses. */
export function stageVisualState(stage: TaskStage): 'done' | 'current' | 'pending' {
  if (stage.status === 'done') return 'done';
  if (stage.status === 'in_progress') return 'current';
  return 'pending';
}

/** What a task is "at" right now, for places that show one line of text
    instead of the full stage list (the calendar cell tooltip, the day-tasks
    list, the workshop task-board row). */
export function currentStageLabel(task: { stages: TaskStage[]; completedAt: string | null; rejectedAt: string | null }): string {
  if (task.rejectedAt) return 'Отклонена';
  if (task.completedAt) return 'Завершена';
  const active = task.stages.find((stage) => stage.status === 'in_progress');
  return active?.label ?? task.stages[0]?.label ?? '—';
}

/** Mirrors the backend's `revertTask` (postgres-workshop-task-repository.ts)
    so the "Вернуть в работу" button can be disabled up front instead of
    letting the click hit the server and surface a raw
    WorkshopTaskNoPrecedingStageError. A fully-completed task can always
    revert (the last stage falls back to in-progress); otherwise there must
    be an in-progress stage AND an earlier 'done' stage to fall back into. */
export function canRevertTask(task: { stages: TaskStage[]; completedAt: string | null }): boolean {
  if (task.completedAt !== null) return true;
  const active = task.stages.find((stage) => stage.status === 'in_progress');
  if (!active) return false;
  return task.stages.some(
    (stage) => Number(stage.sortOrder) < Number(active.sortOrder) && stage.status === 'done',
  );
}
