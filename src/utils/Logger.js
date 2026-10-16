const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRASH: 'CRASH'
};

function safeErrorMessage(error) {
  if (error instanceof Error) return error.message || 'Unknown Error';
  if (typeof error === 'string') return error || 'Unknown Error';
  if (error === null || error === undefined) return 'Unknown Error';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function safeErrorStack(error) {
  if (error instanceof Error && error.stack) return error.stack;
  return 'No stack trace available';
}

function stringifyError(error) {
  if (error instanceof Error) return error.toString();
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return String(error);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function safeStringify(value) {
  if (value instanceof Error) {
    return value.stack || value.toString();
  }
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return String(value);

  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, nested) => {
      if (nested instanceof Error) {
        return {
          name: nested.name,
          message: nested.message,
          stack: nested.stack,
        };
      }
      if (nested && typeof nested === 'object') {
        if (seen.has(nested)) return '[Circular]';
        seen.add(nested);
      }
      return nested;
    });
  } catch {
    try {
      return String(value);
    } catch {
      return '[Unserializable value]';
    }
  }
}

// Pre-encoding character budget for the prefilled issue body (~6KB).
const ISSUE_BODY_BUDGET = 6000;
const STACK_BUDGET = 2000;

function clip(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s;
}

class JulesLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 100;
    this.originalError = console.error.bind(console);
    this.originalWarn = console.warn.bind(console);

    console.error = (...args) => {
      this.log(LOG_LEVELS.ERROR, ...args);
      this.originalError(...args);
    };

    console.warn = (...args) => {
      this.log(LOG_LEVELS.WARN, ...args);
      this.originalWarn(...args);
    };

    window.addEventListener('error', (event) => {
      this.log(LOG_LEVELS.CRASH, event.message, event.filename, event.lineno, event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.log(LOG_LEVELS.CRASH, 'Unhandled Promise Rejection', event.reason);
    });
  }

  log(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(safeStringify).join(' ');

    this.logs.push({ timestamp, level, message });

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  getDump() {
    return this.logs.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
  }

  generateIssueUrl(error) {
    const title = `[Auto-Report] Frontend Crash: ${safeErrorMessage(error)}`.slice(0, 200);
    // GitHub (and browsers/proxies) reject over-long ?body= URLs — after
    // percent-encoding, a 100-entry log dump easily blows past ~8KB and the
    // "report this" link just 414s. Cap the stack, then keep only the most
    // RECENT log lines that still fit in the overall body budget.
    const stack = clip(safeErrorStack(error), STACK_BUDGET);
    const logBudget = Math.max(0, ISSUE_BODY_BUDGET - stack.length - 300);
    const dump = this.getDump();
    const logs = dump.length > logBudget
      ? `…[${dump.length - logBudget} earlier chars truncated]\n${dump.slice(dump.length - logBudget)}`
      : dump;
    const body = `
### Jules Auto-Report
**Context:** Frontend Crash
**Time:** ${new Date().toLocaleString()}

### Stack Trace
\`\`\`
${stack}
\`\`\`

### Recent Logs
\`\`\`
${logs}
\`\`\`
    `.trim();

    const params = new URLSearchParams({
      title,
      body,
      labels: 'jules'
    });

    return `https://github.com/HereLiesAz/hereliesaz.github.io/issues/new?${params.toString()}`;
  }
}

export const logger = new JulesLogger();
export { stringifyError, safeErrorMessage, safeErrorStack, safeStringify };
export default logger;
