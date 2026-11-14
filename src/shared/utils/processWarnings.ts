const SQLITE_WARNING_FILTER_KEY = Symbol.for('osfm.sqliteWarningFilterInstalled');

/**
 * Suppresses Node 24's built-in `ExperimentalWarning` for `node:sqlite`
 * while preserving all other runtime warnings cleanly.
 */
export function suppressSqliteExperimentalWarning(): void {
  const proc = process as NodeJS.Process & Record<symbol, boolean | undefined>;
  if (proc[SQLITE_WARNING_FILTER_KEY]) {
    return;
  }
  proc[SQLITE_WARNING_FILTER_KEY] = true;

  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = typeof warning === 'string' ? warning : warning?.message ?? '';
    const firstArg = args[0];
    const typeOrName =
      typeof firstArg === 'string'
        ? firstArg
        : typeof firstArg === 'object' && firstArg !== null && 'type' in firstArg
          ? String((firstArg as { type?: unknown }).type ?? '')
          : typeof warning === 'object' && warning !== null
            ? warning.name
            : '';

    if (
      message.includes('SQLite') &&
      (typeOrName === 'ExperimentalWarning' || message.toLowerCase().includes('experimental'))
    ) {
      return;
    }

    return (originalEmitWarning as (...params: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;
}
