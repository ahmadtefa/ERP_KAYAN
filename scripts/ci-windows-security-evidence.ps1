[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CandidateDir)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted Windows required' }
$out=Join-Path $PWD 'build/security-evidence'
New-Item -ItemType Directory -Force $out | Out-Null
$setup=(Resolve-Path (Join-Path $CandidateDir 'KAYAN-ERP-Setup.exe')).Path
$hash=(Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant()
$expected='feb03b03f6f5c11ca5ae6fd723f7328615627311eaca343a7c572593eca5dc2d'
if($hash -ne $expected){throw 'Exact candidate hash mismatch'}
$signature=Get-AuthenticodeSignature $setup
$evidence=[ordered]@{candidateSource='2a018207f55f71f127ab3168976db600e11c0afa';sha256=$hash;signatureStatus=$signature.Status.ToString();signatureMessage=$signature.StatusMessage;scanResult='not-run';sampleUploaded=$false;settingsChanged=$false;notMalwareFreeProof=$true;checkedUtc=[DateTime]::UtcNow.ToString('o')}
try {
 $status=Get-MpComputerStatus
 $preference=Get-MpPreference
 $evidence.defender=[ordered]@{antivirusEnabled=$status.AntivirusEnabled;realTimeProtectionEnabled=$status.RealTimeProtectionEnabled;signatureVersion=$status.AntivirusSignatureVersion;signatureLastUpdated=$status.AntivirusSignatureLastUpdated;submitSamplesConsent=[int]$preference.SubmitSamplesConsent}
 # Do not change protection or sample settings and do not risk an automatic
 # sample submission. A hosted runner that cannot satisfy this is unavailable,
 # never a clean scan. This is deliberately not a scan-result bypass.
 if(-not $status.AntivirusEnabled){$evidence.scanResult='unavailable-antivirus-disabled'}
 elseif([int]$preference.SubmitSamplesConsent -ne 2){$evidence.scanResult='not-run-automatic-sample-submission-not-disabled'}
 else {
  $before=@(Get-MpThreatDetection | Select-Object ThreatID,InitialDetectionTime,Resources)
  Start-MpScan -ScanType CustomScan -ScanPath $setup
  $after=@(Get-MpThreatDetection | Where-Object {($_.Resources -join ' ') -like '*KAYAN-ERP-Setup.exe*'})
  $evidence.candidateDetections=@($after | Select-Object ThreatID,InitialDetectionTime,ActionSuccess,Resources)
  $evidence.scanResult=if($after.Count -gt 0){'candidate-detection-present'}else{'completed-no-candidate-detection-reported'}
  $evidence.preexistingDetectionCount=$before.Count
 }
} catch {
 $evidence.scanResult='unavailable-command-failed'
 $evidence.failureCategory=$_.Exception.GetType().Name
} finally {
 $evidence | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $out 'evidence.json') -Encoding utf8
 $evidence | ConvertTo-Json -Depth 8 | Write-Output
}
if($evidence.scanResult -eq 'candidate-detection-present'){throw 'Defender reported candidate detection; review required'}
if($evidence.scanResult -ne 'completed-no-candidate-detection-reported'){throw 'No verified Defender scan result; see evidence for limitation'}
