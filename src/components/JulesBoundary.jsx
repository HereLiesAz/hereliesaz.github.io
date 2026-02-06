import React from 'react';
import { logger } from '../utils/Logger';

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
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: '#000', color: '#ff3333', display: 'flex', 
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'monospace', zIndex: 9999, padding: '20px'
        }}>
          <h1 style={{ fontSize: '4rem', margin: 0 }}>CRITICAL FAILURE</h1>
          <p style={{ opacity: 0.7 }}>The Infinite Canvas has collapsed.</p>
          
          <div style={{ 
            background: '#111', padding: '20px', borderRadius: '4px', 
            margin: '20px 0', maxWidth: '800px', overflow: 'auto' 
          }}>
            {this.state.error.toString()}
          </div>

          <a 
            href={issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: '#ff3333', color: '#000', padding: '15px 30px',
              textDecoration: 'none', fontWeight: 'bold', textTransform: 'uppercase',
              letterSpacing: '2px'
            }}
          >
            REPORT TO JULES
          </a>
        </div>
      );
    }

    return this.props.children;
  }
}

export default JulesBoundary;
