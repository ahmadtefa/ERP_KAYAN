"""Preserve a CI command's exit status and expose failure output as an annotation.

Actions log storage may be unreachable in restricted development environments;
check annotations remain available through api.github.com. Never use for commands
that print credentials or authentication responses.
"""
import subprocess
import sys
from collections import deque

lines = deque(maxlen=45)
process = subprocess.Popen(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
assert process.stdout is not None
for line in process.stdout:
    print(line, end='', flush=True)
    lines.append(line.rstrip())
code = process.wait()
if code:
    message = '\n'.join(lines)
    for raw, escaped in [('%', '%25'), ('\r', '%0D'), ('\n', '%0A')]:
        message = message.replace(raw, escaped)
    print(f'::error title=Command failure::{message}')
sys.exit(code)
