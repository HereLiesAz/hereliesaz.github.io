import React from 'react';
import { logger, stringifyError } from '../utils/Logger';

class JulesBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.log('CRASH', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const issueUrl = logger.generateIssueUrl(this.state.error);
      
      return (
        <div role="alert" style={{
          position: 'fixed', inset: 0, background: 'var(--field, #000)', color: 'var(--ink, #f4f0e6)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display, Georgia, serif)', zIndex: 9999, padding: '20px',
          textAlign: 'center', letterSpacing: '0.12em',
        }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 400, margin: 0, textTransform: 'lowercase', letterSpacing: '0.22em' }}>
            the lights went out
          </h1>
          <p style={{ color: 'var(--ink-dim, rgba(244,240,230,0.7))', fontSize: '0.85rem', margin: '0.6rem 0 1.6rem' }}>
            something broke. reload to try again.
          </p>

          <pre style={{
            maxWidth: '800px', overflow: 'auto', margin: '0 0 1.6rem', padding: 0,
            border: 'none', color: 'var(--ink-faint, rgba(244,240,230,0.5))', fontFamily: 'var(--font-utility, monospace)',
            fontSize: '0.7rem', whiteSpace: 'pre-wrap', letterSpacing: 0,
          }}>
            {stringifyError(this.state.error)}
          </pre>

          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: 'none', border: 'none', borderBottom: '0.5px solid var(--ink, #f4f0e6)', color: 'inherit',
              font: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', padding: '0.7rem 0.3rem', minHeight: 44,
            }}
          >
            reload
          </button>
          <a
            href={issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--ink-faint, rgba(244,240,230,0.5))', fontSize: '0.75rem', marginTop: '1.2rem',
              padding: '0.7rem', textDecoration: 'none', borderBottom: '0.5px solid var(--ink-hairline, rgba(244,240,230,0.15))',
            }}
          >
            report it
          </a>
        </div>
      );
    }

    return this.props.children;
  }
}

export default JulesBoundary;
