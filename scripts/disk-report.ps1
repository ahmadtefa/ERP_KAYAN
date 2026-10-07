#requires -version 5.0
<#
    KAYAN ERP - where did the space go?

    Measures the tools and folders that take up room, ranks the biggest
    folders under the user profile, looks for a second copy of the project,
    and offers to remove the parts that are rebuilt automatically.

    Nothing that holds data is ever touched: no source code, no database,
    no invoices, no backend\.env.

    Called by scripts\free-space.bat so the user never has to touch
    PowerShell's execution policy.
#>

[CmdletBinding()]
param(
    [string]$RootPath = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

$RootPath = (Resolve-Path -LiteralPath $RootPath).Path
$Drive = (Split-Path -Qualifier $RootPath).TrimEnd(':')

# ----------------------------------------------------------- helpers

function Get-FolderSize {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $sum = (Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if (-not $sum) { return [double]0 }
    return [double]$sum
}

function Format-Size {
    param([double]$Bytes)
    if ($Bytes -ge 1GB) { return ('{0,6:N1} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0,6:N0} MB' -f ($Bytes / 1MB)) }
    return ('{0,6:N0} KB' -f ($Bytes / 1KB))
}

function Write-Item {
    param([string]$Path, [string]$Label, [string]$Note = '')
    $size = Get-FolderSize $Path
    if ($null -eq $size) {
        Write-Host ('      {0}  |  {1}' -f '     -', $Label) -ForegroundColor DarkGray
        return [double]0
    }
    $colour = if ($size -ge 5GB) { 'Yellow' } elseif ($size -ge 1GB) { 'White' } else { 'Gray' }
    $line = '      {0}  |  {1}' -f (Format-Size $size), $Label
    if ($Note) { $line += '   ' + $Note }
    Write-Host $line -ForegroundColor $colour
    return $size
}

function Get-FreeSpace {
    param([string]$Letter)
    $free = (Get-PSDrive -Name $Letter -ErrorAction SilentlyContinue).Free
    if ($null -eq $free) { return [double]0 }
    return [double]$free
}

# ----------------------------------------------------------- header

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  KAYAN ERP  -  where did the space go?' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Measures the tools that take up room, then removes the ones'
Write-Host '  that are rebuilt automatically. It asks before it deletes.'
Write-Host ''

$freeBefore = Get-FreeSpace $Drive
$total = (Get-PSDrive -Name $Drive -ErrorAction SilentlyContinue).Used + $freeBefore
$freeGb = $freeBefore / 1GB
$usedGb = ($total - $freeBefore) / 1GB
if ($freeGb -le 0) { $freeGb = 0 }
if ($usedGb -le 0) { $usedGb = 0 }

Write-Host '------------------------------------------------------------'
Write-Host ('  Drive {0}:   {1:N0} GB in use   |   {2:N1} GB free' -f $Drive, $usedGb, $freeGb)
Write-Host '------------------------------------------------------------'
Write-Host ''

if ($freeGb -lt 5) {
    Write-Host '  [WARNING] Less than 5 GB free. This is what makes a Flutter' -ForegroundColor Yellow
    Write-Host '            build fail with "no space left", or stop for no' -ForegroundColor Yellow
    Write-Host '            visible reason at all.' -ForegroundColor Yellow
}
else {
    Write-Host '  [OK] There is enough room for the normal commands.' -ForegroundColor Green
}
Write-Host ''

# ------------------------------------------- 1. the known suspects

Write-Host '------------------------------------------------------------'
Write-Host '  what is taking the room'
Write-Host '------------------------------------------------------------'
Write-Host ''

$known = @(
    @{ Path = (Join-Path $RootPath '.dart_tool');                    Label = 'Dart build state' },
    @{ Path = (Join-Path $RootPath 'build');                         Label = 'the built client';        Note = '(rebuilt on demand)' },
    @{ Path = (Join-Path $RootPath 'backend\dist');                  Label = 'the built server';        Note = '(rebuilt on demand)' },
    @{ Path = (Join-Path $RootPath 'backend\node_modules');          Label = 'server libraries';        Note = '(downloaded again)' },
    @{ Path = (Join-Path $env:LOCALAPPDATA 'Pub\Cache');             Label = 'Flutter packages' },
    @{ Path = (Join-Path $env:LOCALAPPDATA 'Android\Sdk');           Label = 'Android SDK';             Note = '(not needed for web)' },
    @{ Path = (Join-Path $env:USERPROFILE '.gradle');                Label = 'Gradle' },
    @{ Path = (Join-Path $env:LOCALAPPDATA 'kayan-tools');           Label = 'KAYAN tools (Node/Postgres)' },
    @{ Path = (Join-Path $env:LOCALAPPDATA 'npm-cache');             Label = 'npm cache' },
    @{ Path = $env:TEMP;                                             Label = 'temporary files' },
    @{ Path = (Join-Path $env:USERPROFILE 'Downloads');              Label = 'Downloads' }
)

$reclaimable = [double]0
foreach ($item in $known) {
    $size = Write-Item -Path $item.Path -Label $item.Label -Note $item.Note
    if ($item.Label -in @('Dart build state', 'the built client', 'the built server')) {
        $reclaimable += $size
    }
}

$flutterCommand = Get-Command flutter -ErrorAction SilentlyContinue
if ($flutterCommand) {
    $flutterRoot = [System.IO.Path]::GetFullPath(
        (Join-Path (Split-Path $flutterCommand.Source -Parent) '..'))
    Write-Item -Path $flutterRoot -Label 'Flutter SDK' | Out-Null
}
else {
    Write-Host '           -  |  Flutter SDK   (not on PATH)' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  Notes:' -ForegroundColor DarkGray
Write-Host '    * Flutter SDK alone is 3-5 GB. That is normal.' -ForegroundColor DarkGray
Write-Host '    * If you only ever build for the web, you do not need the Android' -ForegroundColor DarkGray
Write-Host '      SDK or Android Studio - usually 10 GB or more.' -ForegroundColor DarkGray
Write-Host '    * The project''s own files are about 27 MB. Not the problem.' -ForegroundColor DarkGray
Write-Host ''

# --------------------------------------- 2. the biggest folders

Write-Host '------------------------------------------------------------'
Write-Host '  the biggest folders under your user profile'
Write-Host '------------------------------------------------------------'
Write-Host ''
Write-Host '  measuring (this can take a minute)...' -ForegroundColor DarkGray

$profileFolders = Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Force -ErrorAction SilentlyContinue
$ranking = @()
foreach ($folder in $profileFolders) {
    $size = Get-FolderSize $folder.FullName
    if ($size -gt 0) {
        $ranking += [PSCustomObject]@{ Bytes = $size; Name = $folder.Name }
    }
}
$ranking = $ranking | Sort-Object Bytes -Descending | Select-Object -First 10

Write-Host ''
foreach ($row in $ranking) {
    Write-Host ('      {0}  |  {1}' -f (Format-Size $row.Bytes), $row.Name) -ForegroundColor Gray
}
Write-Host ''

# ----------------------------------- 3. another copy of the project?

Write-Host '------------------------------------------------------------'
Write-Host '  looking for another copy of the project'
Write-Host '------------------------------------------------------------'
Write-Host ''

$mine = $RootPath.TrimEnd('\').ToLower()
$others = @()
$gitFolders = Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Force -Recurse -Depth 4 `
    -Filter '.git' -ErrorAction SilentlyContinue
foreach ($git in $gitFolders) {
    $parent = $git.Parent.FullName
    if ($parent.TrimEnd('\').ToLower() -ne $mine) { $others += $parent }
}

if ($others.Count -eq 0) {
    Write-Host '      none - good.' -ForegroundColor Green
}
else {
    foreach ($other in $others) {
        $size = Get-FolderSize $other
        Write-Host ('      {0}  |  {1}' -f (Format-Size $size), $other) -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host '      Those are other copies of a project on this machine. If you do' -ForegroundColor Yellow
    Write-Host '      not need them, delete them from File Explorer - but check first' -ForegroundColor Yellow
    Write-Host '      that there is no work inside that is not pushed yet.' -ForegroundColor Yellow
}
Write-Host ''

# ------------------------------------------------------ 4. cleanup

Write-Host '------------------------------------------------------------'
Write-Host '  cleaning'
Write-Host '------------------------------------------------------------'
Write-Host ''
Write-Host '  These will be removed. All of them come back by themselves:'
Write-Host '        .dart_tool      rebuilt on the next run'
Write-Host '        build           rebuilt by serve-web.bat'
Write-Host '        backend\dist    rebuilt by npm run build'
Write-Host '        temporary files older than a week'
Write-Host ''
Write-Host '  Nothing else is touched: no source, no database, no invoices,'
Write-Host '  no backend\.env.'
Write-Host ''

$answer = Read-Host '  continue? (Y/N)'
if ($answer -notmatch '^[Yy]') {
    Write-Host ''
    Write-Host '  Nothing was removed.' -ForegroundColor DarkGray
    Write-Host ''
    return
}

Write-Host ''
Write-Host '  removing...'

foreach ($folder in @('.dart_tool', 'build', 'backend\dist')) {
    $full = Join-Path $RootPath $folder
    if (Test-Path -LiteralPath $full) {
        Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $full) {
            Write-Host ('      {0,-14} could not be removed - something is still using it' -f $folder) -ForegroundColor Yellow
        }
        else {
            Write-Host ('      {0,-14} removed' -f $folder) -ForegroundColor Green
        }
    }
    else {
        Write-Host ('      {0,-14} was not there' -f $folder) -ForegroundColor DarkGray
    }
}

Write-Host '      temporary files older than a week...'
Get-ChildItem -LiteralPath $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Host '      done.' -ForegroundColor Green

# ------------------------------------------------------ 5. result

$freeAfter = Get-FreeSpace $Drive
$freed = $freeAfter - $freeBefore

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  result' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host ('      before : {0:N1} GB free' -f ($freeBefore / 1GB))
Write-Host ('      after  : {0:N1} GB free' -f ($freeAfter / 1GB))
Write-Host ('      freed  : about {0:N1} GB' -f ($freed / 1GB)) -ForegroundColor Green
Write-Host ''

if (($freeAfter / 1GB) -lt 5 -and $reclaimable -gt 0) {
    Write-Host '  Still tight. The three folders above can free about' -ForegroundColor Yellow
    Write-Host ('  {0:N1} GB in total next time you need the room.' -f ($reclaimable / 1GB)) -ForegroundColor Yellow
    Write-Host ''
}

Write-Host '  Need more? See the section "out of disk space" in RUN_LOCALLY.md:' -ForegroundColor DarkGray
Write-Host '  It shows how to move Flutter and the package cache to another drive,' -ForegroundColor DarkGray
Write-Host '  and how to clean up Windows itself.' -ForegroundColor DarkGray
Write-Host ''
