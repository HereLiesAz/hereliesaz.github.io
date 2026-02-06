import os
import sys
import subprocess
from datetime import datetime

def report_issue(error_message, context="CI/CD Pipeline"):
    """
    Uses the GitHub CLI (gh) to open an issue automatically.
    Requires GITHUB_TOKEN to be set in the environment.
    """
    title = f"[Jules] Process Failure: {context}"
    body = f"""
### Automatic Error Report
**Timestamp:** {datetime.now().isoformat()}
**Context:** {context}

### Error Log
