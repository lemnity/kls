import { WorkerRuntime } from './runtime.js';

const runtime = new WorkerRuntime([]);

await runtime.start();

const shutdown = async (signal: string): Promise<void> => {
  console.info(`Worker received ${signal}, shutting down`);
  await runtime.stop();
  process.exitCode = 0;
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
