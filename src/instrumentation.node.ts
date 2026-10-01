import { reportRuntimeIssue } from '@/lib/runtimeIssues';

declare global {
  // eslint-disable-next-line no-var
  var __runtimeIssueProcessHandlersRegistered: boolean | undefined;
}

export function registerNodeInstrumentation(): void {
  if (globalThis.__runtimeIssueProcessHandlersRegistered) return;
  globalThis.__runtimeIssueProcessHandlersRegistered = true;

  const lifecycleContext = {
    pid: process.pid,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    replicaId: process.env.RAILWAY_REPLICA_ID ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  };
  console.info('[lifecycle] started', JSON.stringify(lifecycleContext));
  process.on('exit', code => {
    console.info('[lifecycle] exit', JSON.stringify({ ...lifecycleContext, code }));
  });

  process.on('unhandledRejection', reason => {
    console.error('[unhandledRejection]', reason);
    void reportRuntimeIssue({
      source: 'process',
      operation: 'unhandled_rejection',
      severity: 'critical',
      title: 'Unhandled server promise rejection',
      error: reason,
      context: { pid: process.pid, node_env: process.env.NODE_ENV ?? null },
    });
  });

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    console.error('[uncaughtExceptionMonitor]', origin, error);
    void reportRuntimeIssue({
      source: 'process',
      operation: 'uncaught_exception',
      severity: 'critical',
      title: 'Uncaught server exception',
      error,
      context: { origin, pid: process.pid, node_env: process.env.NODE_ENV ?? null },
    });
  });
}