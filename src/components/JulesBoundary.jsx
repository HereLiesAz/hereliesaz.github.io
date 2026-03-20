import React from 'react';
import { logger } from '../utils/Logger';

class JulesBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    logger.log('CRASH', error, errorInfo);
  }

  handleCopy = () => {
    const { error, errorInfo } = this.state;
    const textToCopy = `Error: ${error?.toString()}\n\nStack Trace:\n${errorInfo?.componentStack || ''}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  render() {
    if (this.state.hasError) {
      const issueUrl = logger.generateIssueUrl(this.state.error);
      
      return (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: '#000', color: '#ff3333', display: 'flex', 
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'monospace', zIndex: 9999, padding: '20px'
        }}>
          <h1 style={{ fontSize: '4rem', margin: 0, textAlign: 'center' }}>CRITICAL FAILURE</h1>
          <p style={{ opacity: 0.7, textAlign: 'center' }}>The Infinite Canvas has collapsed.</p>
          
          <div style={{ 
            background: '#111', padding: '20px', borderRadius: '4px', 
            margin: '20px 0', maxWidth: '800px', width: '100%', overflow: 'auto',
            maxHeight: '40vh', border: '1px solid #333'
          }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {this.state.error?.toString()}
              {this.state.errorInfo?.componentStack}
            </pre>
          </div>

          <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={this.handleCopy}
              style={{
                background: '#333', color: '#fff', border: '1px solid #555', padding: '15px 30px',
                cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase',
                letterSpacing: '2px', fontFamily: 'inherit'
              }}
            >
              {this.state.copied ? 'COPIED!' : 'COPY ERROR LOGS'}
            </button>
            <a 
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: '#ff3333', color: '#000', padding: '15px 30px', border: '1px solid #ff3333',
                textDecoration: 'none', fontWeight: 'bold', textTransform: 'uppercase',
                letterSpacing: '2px', textAlign: 'center'
              }}
            >
              REPORT TO JULES
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default JulesBoundary;
