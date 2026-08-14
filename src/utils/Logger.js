const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRASH: 'CRASH'
};

// React's error boundaries can receive ANY thrown value, not just real
// Error instances (`throw 'oops'`, `throw null`, `throw { code: 1 }` are
// all legal JS). These helpers make sure a non-Error thrown value still
// produces a sensible string instead of throwing again (e.g. calling
// `.message` or `.toString()` on `null`).
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

// Full safe string representation of a thrown value, for display.
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

class JulesLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 100;
    this.originalError = console.error;
    this.originalWarn = console.warn;
    
    // Hijack the console
    console.error = (...args) => {
      this.log(LOG_LEVELS.ERROR, ...args);
      this.originalError(...args);
    };
    
    console.warn = (...args) => {
      this.log(LOG_LEVELS.WARN, ...args);
      this.originalWarn(...args);
    };
    
    // Catch global unhandled errors
    window.addEventListener('error', (event) => {
      this.log(LOG_LEVELS.CRASH, event.message, event.filename, event.lineno);
    });
    
    window.addEventListener('unhandledrejection', (event) => {
      this.log(LOG_LEVELS.CRASH, 'Unhandled Promise Rejection', event.reason);
    });
  }

  log(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    
    this.logs.push({ timestamp, level, message });
    
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  getDump() {
    return this.logs.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
  }

  generateIssueUrl(error) {
    const title = `[Auto-Report] Frontend Crash: ${safeErrorMessage(error)}`;
    const body = `
### Jules Auto-Report
**Context:** Frontend Crash
**Time:** ${new Date().toLocaleString()}

### Stack Trace
\`\`\`
${safeErrorStack(error)}
\`\`\`

### Recent Logs
\`\`\`
${this.getDump()}
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
export { stringifyError, safeErrorMessage, safeErrorStack };
export default logger;
