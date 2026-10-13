<#
.SYNOPSIS
  Checks a packaged Windows copy of KAYAN ERP before it reaches a customer.

.DESCRIPTION
  The build script assembles the folder; this script asks whether what it
  assembled is actually shippable. It needs no database, no server and no
  second machine - only the folder itself - so it can run on the build machine
  straight after the build, and again on any machine the folder is copied to.

  It answers the questions that matter for a standalone copy:
    * is everything a running program needs inside the folder?
    * does the bundled Node runtime actually run, on its own, from here?
    * is the server's entry point loadable by that runtime?
    * did any development secret, or any path from the machine that built it,
      travel inside the package?

  What it cannot check, because it needs Windows with a display and a database,
  is the program's own behaviour: that the window opens, that the server starts
  and that a person can sign in. Those are covered by tools\desktop_check.dart,
  which runs the real launcher against a real database, and by
  tools\desktop_package_check.sh, which does the same to a packaged folder.

.PARAMETER App
  The folder to check. Default: build\desktop\KAYAN-ERP

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\verify-package.ps1
#>

[CmdletBinding()]
param(
  [string]$App = "build\desktop\KAYAN-ERP"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$folder = if ([System.IO.Path]::IsPathRooted($App)) { $App } else { Join-Path $repoRoot $App }

$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
  if ($ok) {
    $script:pass++
    Write-Host "  PASS  $name" -ForegroundColor Green
  } else {
    $script:fail++
    Write-Host "  FAIL  $name   $detail" -ForegroundColor Red
  }
}

function Section([string]$title) {
  Write-Host ""
  Write-Host $title -ForegroundColor Cyan
}

function Has([string]$relative) { Test-Path (Join-Path $folder $relative) }

Write-Host "============================================================"
Write-Host "  KAYAN ERP  -  checking a packaged Windows copy"
Write-Host "============================================================"
Write-Host ""
Write-Host "  folder: $folder"

if (-not (Test-Path $folder)) {
  Write-Host ""
  Write-Host "[X] That folder does not exist. Build it first:" -ForegroundColor Red
  Write-Host "      powershell -ExecutionPolicy Bypass -File scripts\build-desktop-windows.ps1"
  exit 1
}

# ------------------------------------------------------------- 1. the client
Section "[1] The program itself"

$exe = Join-Path $folder "erp_kayan.exe"
Check "erp_kayan.exe is there" (Test-Path $exe)

if (Test-Path $exe) {
  # A Flutter Windows build is a 64-bit PE image. Reading the header proves the
  # file is a Windows program and not, say, an empty placeholder.
  $bytes = [System.IO.File]::ReadAllBytes($exe)[0..1023]
  $isMz = ($bytes[0] -eq 0x4D -and $bytes[1] -eq 0x5A)
  $peAt = [BitConverter]::ToInt32($bytes, 60)
  $isPe = ($peAt -gt 0 -and $peAt -lt 1000 -and
           $bytes[$peAt] -eq 0x50 -and $bytes[$peAt + 1] -eq 0x45)
  $machine = if ($isPe) { [BitConverter]::ToUInt16($bytes, $peAt + 4) } else { 0 }
  Check "it is a Windows program (PE image)" ($isMz -and $isPe)
  Check "it is 64-bit (x64)" ($machine -eq 0x8664) ("machine=0x{0:X4}" -f $machine)
}

Check "the client runtime travels with it (flutter_windows.dll)" (Has "flutter_windows.dll")
Check "its screens and translations travel with it (data\)" (Has "data")
Check "no build leftovers from the developer's machine" (-not (Has "CMakeFiles"))

# The KAYAN icon: the copy the shortcuts point at, and the source it was
# rendered from. An ICO has a zero reserved word and a type word of 1.
$iconFile = Join-Path $folder "icons\app_icon.ico"
Check "the KAYAN icon travels with the program (icons\app_icon.ico)" (Test-Path $iconFile)
Check "the source logo travels with it (icons\Kayan.png)" (Has "icons\Kayan.png")
if (Test-Path $iconFile) {
  $head = [System.IO.File]::ReadAllBytes($iconFile)[0..5]
  $isIco = ($head[0] -eq 0 -and $head[1] -eq 0 -and
            $head[2] -eq 1 -and $head[3] -eq 0)
  $entries = [BitConverter]::ToUInt16($head, 4)
  Check "app_icon.ico is a real multi-size icon" ($isIco -and $entries -ge 1) ("entries=$entries")
}

# ------------------------------------------------------------- 2. the server
Section "[2] The server inside the package"

Check "the compiled server is there (backend\dist\src\main.js)" (Has "backend\dist\src\main.js")
Check "the database schema travels with it" (Has "backend\prisma\schema.prisma")
Check "its migrations travel with it" (Has "backend\prisma\migrations")
Check "the step that prepares the database is there" (Has "backend\scripts\prepare-database.mjs")
if (Has "backend\scripts\prepare-database.mjs") {
  Check "the first administrator step is inside it" `
    ((Get-Content (Join-Path $folder "backend\scripts\prepare-database.mjs") -Raw) -match "KAYAN-DB-STATE")
}
Check "its libraries are there (backend\node_modules)" (Has "backend\node_modules")
Check "Prisma's client was generated for this platform" (Has "backend\node_modules\.prisma\client")

# Full database backups run pg_dump/pg_restore from the program's own folder,
# so the package is not shippable without them - and a copy that cannot answer
# --version from where it now sits is not a copy at all.
$pgDump = Join-Path $folder "backend\pg\pg_dump.exe"
$pgRestore = Join-Path $folder "backend\pg\pg_restore.exe"
Check "the backup tool travels with it (backend\pg\pg_dump.exe)" (Test-Path $pgDump)
Check "the restore tool travels with it (backend\pg\pg_restore.exe)" (Test-Path $pgRestore)
Check "libpq travels next to the tools (backend\pg\libpq.dll)" (Has "backend\pg\libpq.dll")
if (Test-Path $pgDump) {
  $line = & $pgDump --version 2>&1
  Check "pg_dump runs from inside the package" `
    ($LASTEXITCODE -eq 0 -and "$line" -match "pg_dump") ("$line")
}
if (Test-Path $pgRestore) {
  $line = & $pgRestore --version 2>&1
  Check "pg_restore runs from inside the package" `
    ($LASTEXITCODE -eq 0 -and "$line" -match "pg_restore") ("$line")
}

# The development toolchain has no business travelling with a customer's copy.
# Which packages those are is not worth guessing: the lockfile that ships
# inside the package already marks every development-only entry with
# "dev": true, so the check reads that and asks whether any of them is
# installed. Two things do travel and are not mistakes, because production
# packages ask for them and npm answers:
#   * typescript   - a peer dependency of prisma and @prisma/client
#   * @types/node  - a dependency of @fast-csv (through exceljs) and of
#                    @types/jsonwebtoken (through @nestjs/jwt)
# Neither is read at run time; the compiled server needs no compiler.
foreach ($tool in @("@nestjs\cli", "jest", "ts-node")) {
  Check "no development tool shipped: $tool" (-not (Has "backend\node_modules\$tool"))
}

$lockPath = Join-Path $folder "backend\package-lock.json"
if (Test-Path $lockPath) {
  # package-lock.json has an entry whose name is the empty string - the root
  # package - and ConvertFrom-Json refuses to build a property with that name.
  # Reading it as a table works, and on Windows PowerShell 5.1, which has no
  # such switch, the old serializer does the same job.
  $raw = Get-Content $lockPath -Raw
  $lock = $null
  if ($PSVersionTable.PSVersion.Major -ge 6) {
    $lock = ConvertFrom-Json $raw -AsHashtable
  } else {
    Add-Type -AssemblyName System.Web.Extensions
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue
    $serializer.RecursionLimit = 2000
    $lock = $serializer.DeserializeObject($raw)
  }

  $packages = $lock["packages"]
  $devOnly = @()
  foreach ($name in $packages.Keys) {
    $entry = $packages[$name]
    if ($name -and $entry.ContainsKey("dev") -and $entry["dev"] -eq $true) { $devOnly += $name }
  }

  $installed = @($devOnly | Where-Object { Test-Path (Join-Path $folder "backend\$_") })
  Check "nothing the lockfile calls development-only is installed ($($devOnly.Count) such packages)" `
    ($installed.Count -eq 0) ($installed -join ", ")
} else {
  Check "the lockfile travels with the server" $false
}

if (Has "backend\node_modules\typescript") {
  Write-Host ""
  Write-Host "  note  typescript and @types/node travel with the libraries: production" -ForegroundColor Yellow
  Write-Host "        packages declare them (Prisma as a peer, exceljs and @nestjs/jwt" -ForegroundColor Yellow
  Write-Host "        through their own dependencies) and npm installs those by itself." -ForegroundColor Yellow
  Write-Host "        The program never runs either; the compiled server needs no compiler." -ForegroundColor Yellow
}

Check "no TypeScript source of the server travels" `
  (-not (Has "backend\prisma\seed.ts"))
Check "a note for whoever opens the folder" (Has "README.txt")

# --------------------------------------------------------- 3. bundled Node
Section "[3] The Node runtime the program ships with"

$node = Join-Path $folder "backend\node\node.exe"
Check "node.exe is inside the package (the machine needs no Node)" (Test-Path $node)

if (Test-Path $node) {
  $version = & $node --version 2>$null
  Check "and it runs from there" ($LASTEXITCODE -eq 0 -and $version -match "^v\d+") "$version"
  Check "it is a runtime only: no npm is shipped to the customer" `
    (-not (Test-Path (Join-Path $folder "backend\node\node_modules\npm")))
  Check "its licence travels with it" (Has "backend\node\LICENSE")

  # Loading the server's entry point proves the runtime and the compiled server
  # agree, without starting anything or touching a database.
  $syntax = & $node --check (Join-Path $folder "backend\dist\src\main.js") 2>&1
  Check "the server's entry point is loadable by that runtime" ($LASTEXITCODE -eq 0) "$syntax"

  $prepare = & $node --check (Join-Path $folder "backend\scripts\prepare-database.mjs") 2>&1
  Check "the database step is loadable too" ($LASTEXITCODE -eq 0) "$prepare"
}

# ------------------------------------------------------------- 4. hygiene
Section "[4] Nothing that belongs to the developer's machine"

Check "no development .env inside the package" (-not (Has "backend\.env"))
Check "no settings file inside the package (the machine writes its own)" `
  (-not (Has "kayan.env"))
Check "no Git repository inside the package" (-not (Has ".git"))
Check "no source maps of the developer's build" `
  (@(Get-ChildItem (Join-Path $folder "backend\dist") -Recurse -Filter "*.map" -ErrorAction SilentlyContinue).Count -eq 0)

# The example settings file may travel; a real secret may not.
$example = Join-Path $folder "backend\.env.production.example"
if (Test-Path $example) {
  $text = Get-Content $example -Raw
  Check "the example settings carry no real password" `
    ($text -notmatch "postgresql://[^:\s]+:(?!postgres\b|change|your|CHANGE)[^@\s]+@") `
    "a credential looks real"
  Check "the example settings carry no real signing key" ($text -notmatch "JWT_[A-Z_]*SECRET\s*=\s*`"?[A-Za-z0-9_\-]{24,}")
}

# Paths from the machine that built this copy. Prisma writes the folder it was
# generated in into its own client, and the program resolves everything relative
# to where it sits at run time - proven by tools\desktop_package_check.sh, which
# moves a packaged copy to another folder and runs it (32/32). So that one place
# is reported, not failed; anywhere else a build path is a real mistake.
$ours = @(
  (Join-Path $folder "backend\dist"),
  (Join-Path $folder "backend\scripts"),
  (Join-Path $folder "backend\package.json"),
  (Join-Path $folder "README.txt")
)
$leaked = @()
foreach ($path in $ours) {
  if (-not (Test-Path $path)) { continue }
  $files = if ((Get-Item $path).PSIsContainer) {
    Get-ChildItem $path -Recurse -File -Include *.js, *.mjs, *.json, *.txt -ErrorAction SilentlyContinue
  } else { Get-Item $path }
  foreach ($file in $files) {
    $body = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($body -and ($body -match "[A-Za-z]:\\Users\\" -or $body -match "D:\\a\\" -or $body -match "/home/")) {
      $leaked += $file.FullName.Substring($folder.Length + 1)
    }
  }
}
Check "no build-machine path inside the program's own files" ($leaked.Count -eq 0) ($leaked -join ", ")

$prismaClient = Join-Path $folder "backend\node_modules\.prisma\client\index.js"
if (Test-Path $prismaClient) {
  $baked = (Get-Content $prismaClient -Raw) -match "[A-Za-z]:\\|/home/"
  Write-Host ""
  if ($baked) {
    Write-Host "  note  Prisma's generated client mentions the folder it was built in." -ForegroundColor Yellow
    Write-Host "        That text is diagnostic only: the program resolves its paths from" -ForegroundColor Yellow
    Write-Host "        where it is installed, which the packaged-copy check proves by" -ForegroundColor Yellow
    Write-Host "        moving a copy to another folder and running it." -ForegroundColor Yellow
  }
}

# ------------------------------------------------------------- summary
Write-Host ""
Write-Host "============================================================"
if ($script:fail -eq 0) {
  Write-Host "  The package is complete: passed $script:pass, failed $script:fail" -ForegroundColor Green
} else {
  Write-Host "  The package is NOT ready: passed $script:pass, failed $script:fail" -ForegroundColor Red
}
Write-Host "============================================================"
Write-Host ""

if ($script:fail -gt 0) { exit 1 }
