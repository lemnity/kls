export interface WorkerHandler {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

export class WorkerRuntime {
  private started = false;

  public constructor(private readonly handlers: readonly WorkerHandler[]) {}

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    for (const handler of this.handlers) {
      await handler.start();
    }

    this.started = true;
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    for (const handler of [...this.handlers].reverse()) {
      await handler.stop();
    }

    this.started = false;
  }
}
