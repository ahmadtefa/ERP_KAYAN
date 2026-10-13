# KAYAN ERP - asks for the password of the local PostgreSQL "postgres" superuser
# and writes it to a temporary file that initdb reads with --pwfile.
#
# The password is never printed, never put on the command line, and the
# caller deletes the file as soon as initdb has finished.
#
# Exit codes:
#   0 = password written to -OutFile
#   2 = the two entries did not match
#   3 = password too short or contains a line break

param(
    [Parameter(Mandatory = $true)]
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'

function ConvertTo-PlainText {
    param([System.Security.SecureString]$Secure)
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host ''
Write-Host '  Choose a password for the PostgreSQL "postgres" superuser.'
Write-Host '  - at least 12 characters, on one line'
Write-Host '  - input is hidden while you type'
Write-Host '  - write it down: setup-windows.bat asks for it later'
Write-Host ''

$first  = ConvertTo-PlainText (Read-Host -AsSecureString '  new password')
$second = ConvertTo-PlainText (Read-Host -AsSecureString '  repeat password')

if ($first -cne $second) {
    $first = $null; $second = $null
    Write-Host '  [X] The two entries do not match. Nothing was created.' -ForegroundColor Red
    exit 2
}
if ($first.Length -lt 12 -or $first -match "[`r`n]") {
    $first = $null; $second = $null
    Write-Host '  [X] Use at least 12 characters, on one line. Nothing was created.' -ForegroundColor Red
    exit 3
}

# UTF-8 without a byte-order mark: initdb reads the first line as the password.
[IO.File]::WriteAllText($OutFile, $first, (New-Object Text.UTF8Encoding($false)))
$first = $null; $second = $null
exit 0
