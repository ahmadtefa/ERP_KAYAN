"""Preserve a CI command's exit status and expose failure output as an annotation.

Actions log storage may be unreachable in restricted development environments;
check annotations remain available through api.github.com. Never use for commands
that print credentials or authentication responses.
"""
import re
import shutil
import subprocess
import sys
from collections import deque

lines = deque(maxlen=300)
command = [shutil.which(sys.argv[1]) or sys.argv[1], *sys.argv[2:]]
if sys.platform == 'win32' and command[0].lower().endswith(('.bat', '.cmd')):
    command = ['cmd.exe', '/d', '/c', *command]
process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
assert process.stdout is not None
for line in process.stdout:
    line = re.sub(r'''postgres(?:ql)?://[^\s"']+''', '[DATABASE URL REDACTED]', line, flags=re.IGNORECASE)
    print(line, end='', flush=True)
    lines.append(line.rstrip())
code = process.wait()
if code:
    # GitHub truncates individual annotation messages; split the tail rather
    # than losing the actual exception behind dependency/progress output.
    message = '\n'.join(lines)[-27000:]
    chunks = [message[index:index + 3000] for index in range(0, len(message), 3000)]
    for index, chunk in enumerate(chunks, start=1):
        for raw, escaped in [('%', '%25'), ('\r', '%0D'), ('\n', '%0A')]:
            chunk = chunk.replace(raw, escaped)
        print(f'::error title=Command failure {index}/{len(chunks)}::{chunk}')
sys.exit(code)
