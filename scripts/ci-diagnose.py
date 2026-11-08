"""Preserve a CI command's exit status and expose failure output as an annotation.

Actions log storage may be unreachable in restricted development environments;
check annotations remain available through api.github.com. Never use for commands
that print credentials or authentication responses.

The tail alone loses early failures: a suite that fails at test 40 and keeps
printing passing tests until test 700 pushes those first errors out of the
window. So failures are also collected as they stream past and reported ahead
of the tail, with their own test names.
"""
import re
import shutil
import subprocess
import sys
from collections import deque

lines = deque(maxlen=300)
# A failing test's own message, kept even after the tail window moves past it.
failures = deque(maxlen=40)
FAILURE_MARKERS = re.compile(
    r'\[E\]|EXCEPTION CAUGHT BY|^The following .* was thrown|'
    r'Test failed\. See exception logs above|^\s*Expected:|^\s*Actual:|'
    r'Which: .*|^\s*test/.*\.dart:\d+:\d+|^════'
)
command = [shutil.which(sys.argv[1]) or sys.argv[1], *sys.argv[2:]]
if sys.platform == 'win32' and command[0].lower().endswith(('.bat', '.cmd')):
    command = ['cmd.exe', '/d', '/c', *command]
process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
assert process.stdout is not None
for line in process.stdout:
    line = re.sub(r'''postgres(?:ql)?://[^\s"']+''', '[DATABASE URL REDACTED]', line, flags=re.IGNORECASE)
    print(line, end='', flush=True)
    stripped = line.rstrip()
    lines.append(stripped)
    if FAILURE_MARKERS.search(stripped):
        failures.append(stripped)
code = process.wait()
if code:
    # GitHub truncates individual annotation messages; split rather than lose
    # the actual exception behind dependency or progress output. Failures come
    # first so they survive truncation.
    captured = '\n'.join(failures)[-12000:]
    tail = '\n'.join(lines)[-15000:]
    message = f'--- failure lines ---\n{captured}\n--- tail ---\n{tail}'
    chunks = [message[index:index + 3000] for index in range(0, len(message), 3000)]
    for index, chunk in enumerate(chunks, start=1):
        for raw, escaped in [('%', '%25'), ('\r', '%0D'), ('\n', '%0A')]:
            chunk = chunk.replace(raw, escaped)
        print(f'::error title=Command failure {index}/{len(chunks)}::{chunk}')
sys.exit(code)
