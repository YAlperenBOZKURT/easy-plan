export type LogContext = Record<string, unknown>;

function errorDetails(error: unknown): LogContext {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

function write(level: 'debug' | 'info' | 'warn' | 'error', event: string, context: LogContext = {}) {
  const record = { timestamp: new Date().toISOString(), level, event, ...context };
  const sink = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error;
  sink(record);
}

export const logger = {
  debug: (event: string, context?: LogContext) => write('debug', event, context),
  info: (event: string, context?: LogContext) => write('info', event, context),
  warn: (event: string, context?: LogContext) => write('warn', event, context),
  error: (event: string, error: unknown, context?: LogContext) =>
    write('error', event, { ...context, ...errorDetails(error) }),
};

/** React dışındaki senkron ve Promise hatalarını da tek biçimde raporlar. */
export function installGlobalErrorHandlers() {
  const onError = (event: ErrorEvent) => logger.error('window_error', event.error ?? event.message);
  const onUnhandled = (event: PromiseRejectionEvent) => logger.error('unhandled_rejection', event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandled);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandled);
  };
}
