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
{error_message[-3000:]}

*(Log truncated to last 3000 characters if necessary)*

*This issue was automatically created by the Jules Protocol.*
    """
    
    cmd = [
        "gh", "issue", "create",
        "--title", title,
        "--body", body,
        "--label", "jules"
    ]
    
    try:
        print(">> [Jules] Filing formal complaint with GitHub...")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f">> [Jules] Report filed: {result.stdout.strip()}")
    except subprocess.CalledProcessError as e:
        print(f">> [Jules] Failed to file report. Error: {e.stderr}")
    except Exception as e:
        print(f">> [Jules] Unexpected error: {e}")

if __name__ == "__main__":
    # Read error from stdin (piped) or arguments
    error_content = ""
    
    if len(sys.argv) > 1:
        error_content = " ".join(sys.argv[1:])
    else:
        # Check if stdin has data
        if not sys.stdin.isatty():
            error_content = sys.stdin.read()
            
    if error_content.strip():
        report_issue(error_content)
    else:
        print(">> [Jules] No errors detected. Standing by.")
