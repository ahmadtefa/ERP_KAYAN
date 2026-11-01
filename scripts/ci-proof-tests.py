"""Run the suites that carry a change, and record each one as a notice.

A test file committed to the repository proves nothing about a run: the file
can be skipped, renamed, or silently not collected. The job's own log is not
proof either, because Actions log storage is not reachable from every
environment (the same reason `ci-diagnose.py` exists), while check-run
annotations stay available through api.github.com.

So each file named on the command line is run on its own, its output is
streamed to the log, and its final summary line is emitted as a notice titled
with the file's path. A reader of the run can then see, per file, that the
suite ran and what it reported - and a failure still fails the step.
"""
import shutil
import subprocess
import sys

if len(sys.argv) < 2:
    raise SystemExit('usage: ci-proof-tests.py <test file> [<test file> ...]')

flutter = shutil.which('flutter') or 'flutter'
failed = []

for path in sys.argv[1:]:
    print(f'\n--- {path}', flush=True)
    process = subprocess.Popen(
        [flutter, 'test', path, '--reporter', 'expanded'],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert process.stdout is not None
    last = ''
    for line in process.stdout:
        print(line, end='', flush=True)
        stripped = line.strip()
        if stripped:
            last = stripped
    code = process.wait()

    # The expanded reporter ends with "All tests passed!" or
    # "Some tests failed."; anything else is worth showing verbatim too.
    summary = last or 'no output captured'
    print(f'::notice title=Proof suite {path}::{summary}', flush=True)
    if code:
        failed.append(path)

if failed:
    print(
        '::error title=Proof suites failed::'
        + ', '.join(failed),
        flush=True,
    )
    raise SystemExit(1)
