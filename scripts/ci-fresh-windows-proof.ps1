[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CandidateDir)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Fresh hosted Windows required' }
$root=Join-Path $env:ProgramFiles 'KAYAN ERP'
$data=Join-Path $env:ProgramData 'KAYAN-ERP'
if ((Test-Path $root) -or (Test-Path $data) -or (Get-Service KayanERPPostgreSQL -ErrorAction SilentlyContinue)) { throw 'Existing installation refused' }
$expected='2a018207f55f71f127ab3168976db600e11c0afa'
$hash='feb03b03f6f5c11ca5ae6fd723f7328615627311eaca343a7c572593eca5dc2d'
$setup=(Resolve-Path (Join-Path $CandidateDir 'KAYAN-ERP-Setup.exe')).Path
$identity=Get-Content (Join-Path $CandidateDir 'identity.json') -Raw | ConvertFrom-Json
if ($identity.sourceCommit -ne $expected -or $identity.sha256 -ne $hash -or (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Candidate identity mismatch' }
$out=Join-Path $PWD 'build/native-proof'
New-Item -ItemType Directory -Force $out | Out-Null
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,UIAutomationClient,UIAutomationTypes
function Screenshot([string]$name) {
  $bounds=[Windows.Forms.SystemInformation]::VirtualScreen
  $b=New-Object Drawing.Bitmap($bounds.Width,$bounds.Height)
  $g=[Drawing.Graphics]::FromImage($b)
  try { $g.CopyFromScreen($bounds.Location,[Drawing.Point]::Empty,$bounds.Size); $b.Save((Join-Path $out "$name.png"),[Drawing.Imaging.ImageFormat]::Png) } finally { $g.Dispose();$b.Dispose() }
}
$p=Start-Process $setup -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru
if (-not $p.WaitForExit(900000) -or $p.ExitCode -ne 0) { throw 'Fresh install failed or timed out' }
Get-Process erp_kayan -ErrorAction SilentlyContinue | Stop-Process -Force
if ((Get-Service KayanERPPostgreSQL).Status -ne 'Running') { throw 'Installed PostgreSQL not running' }
$manifest=Get-Content (Join-Path $root 'runtime-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.sourceCommit -ne $expected -or $manifest.licenseEnforcement -ne 'enforce') { throw 'Installed manifest differs or enforcement missing' }
$logPaths=@((Join-Path $env:APPDATA 'KAYAN-ERP/logs/backend.log'),(Join-Path $data 'logs/backend.log'))
foreach ($phase in @('first-launch','restart')) {
  $offsets=@{};foreach($log in $logPaths){$offsets[$log]=if(Test-Path $log){(Get-Item $log).Length}else{0}}
  $client=Start-Process (Join-Path $root 'erp_kayan.exe') -WorkingDirectory $root -PassThru
  try {
    $asking=$false
    for($i=0;$i -lt 90;$i++){
      if($client.HasExited){throw 'Installed client exited during first-run proof'}
      foreach($log in $logPaths){if(Test-Path $log){$f=[IO.File]::Open($log,'Open','Read','ReadWrite');try{$null=$f.Seek($offsets[$log],'Begin');$r=New-Object IO.StreamReader($f);if($r.ReadToEnd() -match 'asking who the first administrator is'){$asking=$true}}finally{$f.Dispose()}}}
      if($asking){break};Start-Sleep 1
    }
    if(-not $asking){throw 'Installed first-run waiting state not observed'}
    Start-Sleep 4
    Screenshot $phase
    foreach($port in @(3000,3001,3002,3003,3010,3020)){
      $answers=$false;try{$v=Invoke-RestMethod "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 1;$answers=[bool]$v.status}catch{}
      if($answers){throw 'API started before first-administrator setup'}
    }
  } finally {if(-not $client.HasExited){$null=$client.CloseMainWindow();if(-not $client.WaitForExit(10000)){Stop-Process -Id $client.Id -Force}}}
}
# A separate app exercises the exact shared helper code. Not an installed business flow.
$probeDir='C:\kayan-native-dialog-fixture'
New-Item -ItemType Directory $probeDir | Out-Null
[IO.File]::WriteAllText((Join-Path $probeDir 'visible.json'),'{}')
[IO.File]::WriteAllText((Join-Path $probeDir 'hidden.txt'),'not allowed')
$env:KAYAN_PROBE_DIR=$probeDir
$probe=Start-Process (Join-Path $PWD 'build/windows/x64/runner/Release/erp_kayan.exe') -PassThru
$keys=New-Object -ComObject WScript.Shell
function Wait-Stage([string]$want){for($i=0;$i -lt 90;$i++){if(Test-Path "$probeDir/stage.txt"){$s=Get-Content "$probeDir/stage.txt" -Raw;if($s -like 'failed:*'){throw $s};if($s -eq $want){return}};Start-Sleep 1};throw "Probe stage timeout: $want"}
function Test-ProbeProcess([int]$candidateId) {
 # Save As belongs to Flutter; OpenFileDialog is owned by its PowerShell child.
 # Accept only this probe process or a proven descendant, never a title alone.
 for($depth=0;$depth -lt 4;$depth++){
  if($candidateId -eq $probe.Id){return $true}
  $processInfo=Get-CimInstance Win32_Process -Filter "ProcessId=$candidateId" -ErrorAction SilentlyContinue
  if(-not $processInfo){return $false}
  $candidateId=[int]$processInfo.ParentProcessId
 }
 return $false
}
function Wait-Dialog([string]$title) {
 for($i=0;$i -lt 30;$i++){
  $classCondition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')
  $windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Descendants,$classCondition)
  foreach($w in $windows){
   try {
    if((Test-ProbeProcess $w.Current.ProcessId) -and $w.Current.Name -eq $title -and -not $w.Current.IsOffscreen -and $w.Current.IsEnabled){
     $readyEdit=Find-FileNameEdit $w
     if($readyEdit){return $w}
    }
   } catch {}
  }
  if(Test-Path "$probeDir/stage.txt"){$stage=Get-Content "$probeDir/stage.txt" -Raw;if($stage -like 'failed:*'){Screenshot 'dialog-helper-failed';throw $stage}}
  Start-Sleep 1
 }
 Screenshot 'dialog-discovery-timeout'
 $tree=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
 @($tree | ForEach-Object { [ordered]@{name=$_.Current.Name;class=$_.Current.ClassName;pid=$_.Current.ProcessId;type=$_.Current.ControlType.ProgrammaticName} }) | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'dialog-tree.json')
 throw 'Native dialog absent'
}
function Find-FileNameEdit([Windows.Automation.AutomationElement]$dialog){
 # The same label belongs to a Text label, ComboBox and its editable child.
 # Require the actual focusable Edit with a writable ValuePattern.
 $type=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Edit)
 $edits=$dialog.FindAll([Windows.Automation.TreeScope]::Descendants,$type)
 foreach($candidate in $edits){
  if($candidate.Current.Name -ne 'File name:' -or -not $candidate.Current.IsEnabled -or $candidate.Current.IsOffscreen -or -not $candidate.Current.IsKeyboardFocusable){continue}
  $pattern=$null
  if($candidate.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern) -and -not $pattern.Current.IsReadOnly){return $candidate}
 }
 return $null
}
function Invoke-DialogPrimary([Windows.Automation.AutomationElement]$dialog){
 $condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty,'1')
 $primary=$dialog.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
 if(-not $primary -or -not $primary.Current.IsEnabled){throw 'Native primary action absent'}
 $primary.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
}
function Set-FileName([Windows.Automation.AutomationElement]$dialog,[string]$value){
 $edit=Find-FileNameEdit $dialog
 if(-not $edit){throw 'Native writable filename Edit absent'}
 $edit.SetFocus()
 $pattern=$edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
 $pattern.SetValue($value)
 Start-Sleep 1
 # Commit a real edit notification without Ctrl+A racing modifier state.
 $keys.SendKeys('{END}')
 $keys.SendKeys('{BACKSPACE}')
 $keys.SendKeys($value.Substring($value.Length-1))
 $keys.SendKeys('{TAB}')
 Start-Sleep 1
}
try {
 Wait-Stage 'save';Start-Sleep 3;Screenshot 'before-dialog-discovery';$w=Wait-Dialog 'Save As';$null=$keys.AppActivate($w.Current.ProcessId);Start-Sleep 2
 Screenshot 'native-save-as'
 Set-FileName $w (Join-Path $probeDir 'chosen.dump');Screenshot 'native-save-chosen-path';$buttonCondition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty,'1');$button=$w.FindFirst([Windows.Automation.TreeScope]::Descendants,$buttonCondition);$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
 Wait-Stage 'open';$w=Wait-Dialog 'Open';$null=$keys.AppActivate($w.Current.ProcessId);Start-Sleep 2
 # Navigate via the address bar, not the filename/filter controls.
 $w.SetFocus();$keys.SendKeys('%d');Start-Sleep 1
 $keys.SendKeys($probeDir);$keys.SendKeys('{ENTER}');Start-Sleep 3
 Screenshot 'native-open-directory'
 $elements=$w.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
 # Explorer may hide known extensions in display names. Compare only real
 # file-list items and accept either shell display form, never labels/filters.
 $names=@($elements | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::ListItem -and $_.Current.ClassName -eq 'UIItem' } | ForEach-Object {$_.Current.Name})
 $allowedVisible=($names -contains 'visible.json') -or ($names -contains 'visible')
 $forbiddenVisible=($names -contains 'hidden.txt') -or ($names -contains 'hidden')
 if(-not $allowedVisible -or $forbiddenVisible){
  @($elements | ForEach-Object { [ordered]@{name=$_.Current.Name;class=$_.Current.ClassName;type=$_.Current.ControlType.ProgrammaticName} }) | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'filter-tree.json')
  throw 'Allowed extension not visible by default or forbidden file visible'
 }
 Screenshot 'native-open-filter'
 Set-FileName $w 'visible.json';Invoke-DialogPrimary $w
 Wait-Stage 'cancel';$w=Wait-Dialog 'Save As';$null=$keys.AppActivate($w.Current.ProcessId);Start-Sleep 1;Screenshot 'native-save-cancel';$keys.SendKeys('{ESC}')
 Wait-Stage 'passed'
}catch{Screenshot 'native-error';throw}finally{if(-not $probe.HasExited){Stop-Process -Id $probe.Id -Force}}
[ordered]@{result='fresh-install-first-run-restart-and-isolated-native-helper-proof';candidateSource=$expected;installerSha256=$hash;proofSource=$env:GITHUB_SHA;installedBusinessFlowTested=$false;activatedLicenceTested=$false;resetExecuted=$false;nativeSharedHelperSaveOpenCancel=$true} | ConvertTo-Json | Set-Content (Join-Path $out 'evidence.json') -Encoding utf8
