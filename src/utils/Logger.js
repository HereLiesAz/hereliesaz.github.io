const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRASH: 'CRASH'
};

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
    const title = `[Auto-Report] Frontend Crash: ${error.message || 'Unknown Error'}`;
    const body = `
### Jules Auto-Report
**Context:** Frontend Crash
**Time:** ${new Date().toLocaleString()}

### Stack Trace
\`\`\`
${error.stack || 'No stack trace available'}
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
export default logger;
