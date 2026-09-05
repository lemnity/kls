import { describe, expect, it } from 'vitest';

import { WorkerRuntime, type WorkerHandler } from './runtime.js';

describe('WorkerRuntime', () => {
  it('starts handlers once and stops them in reverse order', async () => {
    const events: string[] = [];
    const handler = (name: string): WorkerHandler => ({
      start: async () => {
        events.push(`start:${name}`);
      },
      stop: async () => {
        events.push(`stop:${name}`);
      },
    });

    const runtime = new WorkerRuntime([handler('first'), handler('second')]);

    await runtime.start();
    await runtime.start();
    await runtime.stop();
    await runtime.stop();

    expect(events).toEqual([
      'start:first',
      'start:second',
      'stop:second',
      'stop:first',
    ]);
  });
});
