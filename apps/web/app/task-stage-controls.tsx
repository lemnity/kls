'use client';

import { useState } from 'react';

import { CheckIcon, CrossIcon, UndoIcon } from './icons.js';

/**
 * The real "Принять / Вернуть в работу / Отклонить" decision row —
 * replaces the permanently-disabled placeholder buttons that used to sit
 * here (see the classic task's ClassicTaskUnavailableDecisions and the
 * graph-node task's own disabled revert button). Shared by the calendar's
 * TaskDetailStepper and the workshop's TaskBoard so the two surfaces don't
 * drift into two different button sets for the same three actions.
 */
export function TaskDecisionButtons({
  disabled,
  canRevert = true,
  onAdvance,
  onRevert,
  onReject,
}: {
  disabled?: boolean;
  /** Whether reverting is currently possible at all (see `canRevertTask` in
      lib/task-stages.ts) — false disables the middle button up front instead
      of letting the click hit the server and surface a raw
      WorkshopTaskNoPrecedingStageError. Defaults to true so existing callers
      that don't pass it keep today's behaviour. */
  canRevert?: boolean;
  onAdvance: () => void;
  onRevert: () => void;
  onReject: () => void;
}) {
  return (
    <div className="budget-graph__task-actions">
      <button type="button" className="task-decision task-decision--accept" disabled={disabled} onClick={onAdvance}>
        <span className="task-decision__icon">
          <CheckIcon />
        </span>
        <span className="task-decision__label">Принять</span>
      </button>
      <button
        type="button"
        className="task-decision task-decision--neutral"
        disabled={disabled || !canRevert}
        title={!canRevert ? 'Это первый этап — возвращаться некуда' : undefined}
        onClick={onRevert}
      >
        <span className="task-decision__icon">
          <UndoIcon />
        </span>
        <span className="task-decision__label">Вернуть в работу</span>
      </button>
      <button type="button" className="task-decision task-decision--reject" disabled={disabled} onClick={onReject}>
        <span className="task-decision__icon">
          <CrossIcon />
        </span>
        <span className="task-decision__label">Отклонить</span>
      </button>
    </div>
  );
}

/** Inline "Добавить этап" form — a bare label, appended at the end by
    default (or after a chosen stage, if the caller wants that later). */
export function AddStageForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (label: string) => void;
  submitting?: boolean;
}) {
  const [label, setLabel] = useState('');

  return (
    <form
      className="task-stage-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = label.trim();
        if (!trimmed || submitting) return;
        onSubmit(trimmed);
        setLabel('');
      }}
    >
      <label>
        <span className="sr-only">Название этапа</span>
        <input
          type="text"
          placeholder="Название этапа"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn-pill btn-pill--ghost btn-pill--small" disabled={!label.trim() || submitting}>
        {submitting ? 'Добавляем…' : '+ Добавить этап'}
      </button>
    </form>
  );
}

/** Inline "Редактировать этап" rename control — rename only, no reordering. */
export function EditStageForm({
  initialLabel,
  onSubmit,
  onCancel,
  submitting,
}: {
  initialLabel: string;
  onSubmit: (label: string) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const [label, setLabel] = useState(initialLabel);

  return (
    <form
      className="task-stage-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = label.trim();
        if (!trimmed || submitting) return;
        onSubmit(trimmed);
      }}
    >
      <label>
        <span className="sr-only">Название этапа</span>
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          required
          autoFocus
        />
      </label>
      <button type="submit" className="btn-pill btn-pill--accent btn-pill--small" disabled={!label.trim() || submitting}>
        {submitting ? 'Сохраняем…' : 'Сохранить'}
      </button>
      <button type="button" className="btn-pill btn-pill--ghost btn-pill--small" onClick={onCancel}>
        Отмена
      </button>
    </form>
  );
}
