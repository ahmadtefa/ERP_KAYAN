#!/usr/bin/env python3
"""Inspect one historical Actions ZIP in memory; do not build or install anything.

The artifact and Inno payload are never written to disk. Only names, sizes,
checksums, and tooling errors are written to the job summary. Unknown Inno
versions fail closed. This report is not proof of missing secrets or runtime
correctness and cannot inspect the newer EXE, which has no artifact.
"""
import hashlib
import io
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile

ARTIFACT = 12767883681
EXPECTED_ZIP = 'f5f322b8007613f611c955c2e1dadcdaccb743765a2b06982b8d236e535f1bd4'
EXPECTED_EXE = 'a86f800cc15d0215b7cb49b3c17e67769995e35f07f659061c1d8d8ad92e7401'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def download():
    token = os.environ['GH_TOKEN']
    url = f'https://api.github.com/repos/ahmadtefa/ERP_KAYAN/actions/artifacts/{ARTIFACT}/zip'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'User-Agent': 'kayan-historical-inventory'})
    try:
        urllib.request.build_opener(NoRedirect).open(req, timeout=60)
        raise RuntimeError('GitHub artifact API did not return a redirect')
    except urllib.error.HTTPError as e:
        if e.code not in (301, 302, 303, 307, 308):
            raise RuntimeError(f'GitHub artifact API refused download (HTTP {e.code})') from None
        location = e.headers.get('Location')
    if not location or not location.startswith('https://'):
        raise RuntimeError('Missing secure artifact redirect')
    # No Authorization header is forwarded to the signed artifact URL.
    with urllib.request.urlopen(urllib.request.Request(location, headers={'User-Agent': 'kayan-historical-inventory'}), timeout=300) as response:
        return response.read()

def report(line):
    print(line, flush=True)
    # Annotations remain accessible when GitHub log archives cannot be reached.
    escaped = line.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f'::notice title=Historical inventory::{escaped[:3500]}', flush=True)
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as out:
        out.write(line + '\n')

def main():
    raw = download()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_ZIP:
        raise RuntimeError('Historical ZIP SHA-256 mismatch')
    report(f'Historical Actions ZIP: {len(raw)} bytes; SHA-256 `{digest}`; artifact {ARTIFACT}.')
    archive = zipfile.ZipFile(io.BytesIO(raw))
    infos = archive.infolist()
    for info in infos:
        # ZIP entry names are metadata only, not file contents.
        report(f'- ZIP entry `{info.filename.replace(chr(96), "_")}`: {info.file_size} uncompressed bytes; {info.compress_size} compressed bytes.')
    candidates = [i for i in infos if i.filename.replace('\\', '/').rsplit('/', 1)[-1] == 'KAYAN-ERP-Setup.exe']
    if len(candidates) != 1:
        raise RuntimeError('Canonical EXE is missing or ambiguous in historical ZIP')
    info = candidates[0]
    fd = os.memfd_create('kayan-historical-exe', 0)
    sha = hashlib.sha256()
    count = 0
    with archive.open(info) as src:
        while chunk := src.read(1024 * 1024):
            sha.update(chunk)
            count += len(chunk)
            view = memoryview(chunk)
            while view:
                view = view[os.write(fd, view):]
    if count != info.file_size or sha.hexdigest() != EXPECTED_EXE:
        raise RuntimeError('Historical executable size or SHA-256 mismatch')
    report(f'Historical EXE: {count} bytes; SHA-256 `{sha.hexdigest()}`; ZIP CRC also verified while reading.')
    # Probe only the fixed public Inno format identifier, never arbitrary bytes.
    # This is metadata evidence and does not validate the structure or content.
    import mmap
    with mmap.mmap(fd, 0, access=mmap.ACCESS_READ) as mapped:
        patterns = set(match.group().decode('ascii') for match in re.finditer(rb'Inno Setup Setup Data \([0-9.]{1,20}\)(?: \(u\))?', mapped))
    report('Raw Inno data identifiers: ' + (', '.join(sorted(patterns)) if patterns else 'not found in executable bytes'))
    os.lseek(fd, 0, os.SEEK_SET)
    exe = f'/proc/self/fd/{fd}'
    # Compare the exact upstream PostgreSQL input archive named in both source
    # commits. These are staging-input sizes, not sizes measured inside either
    # final EXE. No files are extracted and all archive bytes remain in memory.
    pg_url = 'https://get.enterprisedb.com/postgresql/postgresql-17.7-1-windows-x64-binaries.zip'
    pg_expected = '2aacc055d9bac49763ac0164759c13866bc0235123d7ffdbb6a6aaa20dc25d9a'
    with urllib.request.urlopen(urllib.request.Request(pg_url, headers={'User-Agent': 'kayan-historical-inventory'}), timeout=300) as response:
        pg_raw = response.read()
    if hashlib.sha256(pg_raw).hexdigest() != pg_expected:
        raise RuntimeError('PostgreSQL source archive SHA-256 mismatch')
    pg = zipfile.ZipFile(io.BytesIO(pg_raw))
    matches = [item.filename for item in pg.infolist() if item.filename.replace('\\\\', '/').lower().endswith('/bin/initdb.exe')]
    if len(matches) != 1:
        raise RuntimeError('PostgreSQL source archive root is ambiguous')
    root = matches[0].replace('\\\\', '/')[:-len('bin/initdb.exe')]
    groups = {}
    for item in pg.infolist():
        name = item.filename.replace('\\\\', '/')
        if not name.startswith(root) or item.is_dir():
            continue
        rel = name[len(root):]
        top = rel.split('/', 1)[0] if '/' in rel else '(root files)'
        sizes = groups.setdefault(top, [0, 0, 0])
        sizes[0] += 1
        sizes[1] += item.file_size
        sizes[2] += item.compress_size
    report(f'PostgreSQL input ZIP: {len(pg_raw)} bytes; SHA-256 verified; group sizes below are not final EXE sizes.')
    for name, (files, size, compressed) in sorted(groups.items(), key=lambda x: -x[1][1]):
        included = name in ('bin', 'lib', 'share')
        report(f'PostgreSQL `{name}`: {files} files, {size} uncompressed bytes, {compressed} ZIP-compressed bytes; new runtime tree {"included" if included else "not copied as a tree"}.')
    version = subprocess.run(['innoextract', '--version'], capture_output=True, text=True, timeout=15)
    report(f"Inno extractor: `{version.stdout.splitlines()[0] if version.stdout else 'unknown'}` from runner OS packages.")
    listing = subprocess.run(['innoextract', '--list', '--list-sizes', exe], pass_fds=(fd,), capture_output=True, text=True, errors='replace', timeout=180)
    if listing.returncode:
        report('Inno listing failed or the installed extractor does not support this format/version; no payload inventory is claimed.')
        # Only generic diagnostics; do not print arbitrary installer contents.
        text = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', listing.stderr)
        safe = [line for line in text.splitlines() if re.search(r'unknown|unsupported|version|error|failed|not a|cannot', line, re.I)]
        for line in safe[:8]:
            report('- Extractor diagnostic: ' + line[:400].replace('`', "'"))
        raise RuntimeError('Historical Inno inventory not verified')
    report('### Historical Inno file listing (extractor metadata; no files extracted)')
    clean = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', listing.stdout)
    # GitHub imposes a summary limit. Explicitly indicate if the list exceeds it.
    if len(clean.encode('utf-8')) > 900_000:
        report('Listing exceeds the job-summary limit; output below is truncated and is not a complete inventory.')
        clean = clean.encode('utf-8')[:900_000].decode('utf-8', errors='ignore')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as out:
        out.write('<pre>\n' + clean.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') + '\n</pre>\n')
    check = subprocess.run(['innoextract', '--test', exe], pass_fds=(fd,), capture_output=True, text=True, errors='replace', timeout=900)
    if check.returncode:
        raise RuntimeError('Inno checksum verification failed or is unsupported')
    report('Historical Inno payload checksums: verified by innoextract without extracting to disk; not a runtime/offline test.')
    report('New product-mode EXE: no artifact was published; no byte-for-byte or file-level comparison was possible.')
    os.close(fd)

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Do not emit arbitrary URL exceptions: signed download URLs are
        # credentials. Only known, explicitly constructed reasons are safe.
        reason = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        reason = reason.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::error title=Historical inventory incomplete::{reason}', flush=True)
        sys.exit(1)
