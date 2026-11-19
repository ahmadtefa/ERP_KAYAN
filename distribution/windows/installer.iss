; This script must be invoked by the build script with an explicit build kind.
; This is a labelling/accidental-bypass guard, not a security boundary against
; someone deliberately invoking ISCC with arbitrary defines and staged files.
#ifndef KayanBuildKind
  #error "Use build-installer.ps1 with an explicit validated build kind."
#endif
#if KayanBuildKind == "product"
  #define AppName "KAYAN ERP"
  #define SetupBase "KAYAN-ERP-Setup"
#elif KayanBuildKind == "test-signed"
  #define AppName "KAYAN ERP - TEST ONLY"
  #define SetupBase "KAYAN-ERP-TEST-ONLY-Setup"
#elif KayanBuildKind == "evaluation"
  #define AppName "KAYAN ERP - EVALUATION ONLY"
  #define SetupBase "KAYAN-ERP-EVALUATION-ONLY-Setup"
#else
  #error "Unknown KAYAN build kind."
#endif
#define AppId "{{D1B6074C-12D1-4B4A-9F2C-650A53F15D91}"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\build\windows-installer-stage\KAYAN-ERP"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\build\windows-installer"
#endif

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=KAYAN
DefaultDirName={autopf}\KAYAN ERP
DefaultGroupName=KAYAN ERP
; The destination is not offered. The uninstaller removes what it installed,
; but a user who picked an unrelated folder - C:\Tools, or a folder that
; already holds other software - would have that folder's contents removed
; with it. One fixed location avoids the question entirely.
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#SetupBase}-{#AppVersion}-x64
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; KAYAN ERP supports Windows 10 and Windows 11 only. The bundled PostgreSQL 17
; and Node.js 24 payloads have no supported configuration on earlier Windows,
; so Setup refuses to start there instead of installing a runtime that cannot
; run. 10.0 is Windows 10 / Windows Server 2016; Windows 11 and every later
; release report a higher build number and are covered by the same floor.
MinVersion=10.0
PrivilegesRequired=admin
; The KAYAN mark on Setup.exe itself and on the uninstall entry. setup.ico
; is staged next to this script by build-installer.ps1, which generates it
; from the approved brand image before Inno Setup runs.
SetupIconFile={#SourcePath}setup.ico
UninstallDisplayIcon={app}\erp_kayan.exe
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
Uninstallable=yes
UninstallDisplayName=KAYAN ERP

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"

[CustomMessages]
; The company page. Both languages are spelled out here rather than left to
; the .isl files, because this page is the one place where the customer has to
; understand a decision about their data before Setup touches anything.
english.CompanyPageCaption=The company on this computer
arabic.CompanyPageCaption=الشركة على هذا الجهاز
english.CompanyPageDescription=Setup can start a new, empty company, or keep the company already on this computer. Setup never deletes company data.
arabic.CompanyPageDescription=يمكن للمُثبِّت بدء شركة جديدة فارغة، أو الاحتفاظ بالشركة الموجودة بالفعل على هذا الجهاز. لا يحذف المُثبِّت بيانات الشركة أبدًا.
english.CompanyNew=A new company (شركة جديدة)
arabic.CompanyNew=شركة جديدة (A new company)
english.CompanyExisting=An existing company (شركة موجودة)
arabic.CompanyExisting=شركة موجودة (An existing company)
; The item list on an option page shows one caption per choice, so the
; consequences of each choice are spelled out under the list, in the page's
; own sub-caption, instead of being attached to the item.
english.CompanyChoiceHint=A new company: Setup creates a brand-new empty database and the program then asks for the company and the general manager. A company already on this computer is backed up first and kept - Setup never deletes, empties or reuses it, so its data can always be recovered. No demo data is added. An existing company: every record already on this computer is kept; Setup verifies the database, backs it up, then upgrades it in place.
arabic.CompanyChoiceHint=شركة جديدة: يُنشئ المُثبِّت قاعدة بيانات جديدة فارغة، ثم يسأل البرنامج عن بيانات الشركة والمدير العام. وأي شركة موجودة على هذا الجهاز تُؤخذ لها نسخة احتياطية أولًا وتبقى كما هي — لا يحذفها المُثبِّت ولا يفرّغها ولا يعيد استخدامها، فبياناتها قابلة للاسترجاع دائمًا. ولا تُضاف بيانات تجريبية. شركة موجودة: يُحتفظ بكل البيانات الموجودة على هذا الجهاز؛ يتحقق المُثبِّت من قاعدة البيانات ويأخذ نسخة احتياطية، ثم يرقّيها في مكانها.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
#if KayanBuildKind == "product"
; Extracted only for the pre-install comparison, before files or services change.
Source: "{#SourceDir}\public-key.pem"; Flags: dontcopy noencryption
#endif
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\KAYAN ERP"; Filename: "{app}\erp_kayan.exe"; WorkingDir: "{app}"
; Two ways to leave this computer, and they are separate menu entries so the
; destructive one cannot be reached by mis-clicking the ordinary uninstall.
Name: "{group}\Uninstall KAYAN ERP (keep company data)"; Filename: "{uninstallexe}"
Name: "{group}\Remove everything (delete all data)"; Filename: "{uninstallexe}"; Parameters: "/REMOVEEVERYTHING"
Name: "{group}\Repair KAYAN ERP"; Filename: "{app}\RepairTool.exe"; WorkingDir: "{app}"
Name: "{group}\Repair KAYAN ERP (command line)"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\repair-runtime.ps1"""; WorkingDir: "{app}"
; Safe reset is a separate, manual tool: it is never run by Setup, by an
; update, by Repair or by the program. It requires typing RESET, takes a
; verified backup first, creates a NEW database beside the old one (the
; old database is never emptied or deleted), and only then points the
; settings at it - with automatic rollback if verification fails.
Name: "{group}\Reset KAYAN ERP (start fresh)"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\reset-kayan.ps1"""; WorkingDir: "{app}"
Name: "{group}\Start PostgreSQL"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\database-control.ps1"" -Action start"; WorkingDir: "{app}"
Name: "{group}\Stop PostgreSQL"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\database-control.ps1"" -Action stop"; WorkingDir: "{app}"
Name: "{group}\Restart PostgreSQL"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\database-control.ps1"" -Action restart"; WorkingDir: "{app}"
Name: "{autodesktop}\KAYAN ERP"; Filename: "{app}\erp_kayan.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\erp_kayan.exe"; Description: "Launch KAYAN ERP"; Flags: postinstall nowait skipifsilent runasoriginaluser

[UninstallDelete]
Type: dirifempty; Name: "{app}"

[Code]
var
  CompanyPage: TInputOptionWizardPage;
  RuntimeFailed: Boolean;

{ Preserve a failing exit status even if a post-install exception is reported
  after Inno has already marked its file-copy phase successful. }
function GetCustomSetupExitCode: Integer;
begin
  if RuntimeFailed then Result := 1 else Result := 0;
end;

{ Test installers are deliberately non-installable: the runtime still uses
  customer paths and services, so a label or a clean-looking host is not
  sufficient isolation. Product upgrades must preserve the existing key. }
{ Stops an upgrade without ever waiting for a click that will not come.
  /SUPPRESSMSGBOXES does not answer a plain MsgBox; it only answers
  SuppressibleMsgBox. An unattended install that hit a plain box here sat on an
  invisible dialog until the job timed out, which is exactly what happened to
  the offline smoke on run 42901077717. Silent runs now record the reason in the
  log and leave; interactive runs still see the dialog. }
procedure RefuseUpgrade(const Reason: String);
begin
  if WizardSilent then begin
    Log('Upgrade refused without a dialog because setup is silent: ' + Reason);
    Exit;
  end;
  SuppressibleMsgBox(Reason, mbError, MB_OK, IDOK);
end;

function InitializeSetup(): Boolean;
#if KayanBuildKind == "product"
var
  ExistingDir, ExistingKey, Marker, StateFile, IncomingKey, ExistingHash, IncomingHash: String;
#endif
begin
#if KayanBuildKind != "product"
  SuppressibleMsgBox('TEST/EVALUATION build: installation is disabled because its runtime is not isolated from customer paths.', mbError, MB_OK, IDOK);
  Result := False;
#else
  Result := False;
  ExistingDir := ExpandConstant('{commonappdata}\KAYAN-ERP\license');
  ExistingKey := ExpandConstant('{commonappdata}\KAYAN-ERP\license\public-key.pem');
  Marker := ExpandConstant('{commonappdata}\KAYAN-ERP\license\enforcement.required');
  StateFile := ExpandConstant('{commonappdata}\KAYAN-ERP\license\license-state.json');
  if FileExists(ExistingKey) then begin
    ExtractTemporaryFile('public-key.pem');
    IncomingKey := ExpandConstant('{tmp}\public-key.pem');
    ExistingHash := GetSHA256OfFile(ExistingKey);
    IncomingHash := GetSHA256OfFile(IncomingKey);
    { Empty hashes must never compare equal and authorize an upgrade. }
    if (Length(ExistingHash) <> 64) or (Length(IncomingHash) <> 64) or (CompareText(ExistingHash, IncomingHash) <> 0) then begin
      RefuseUpgrade('The installed licence verification key is unreadable or differs from this installer. Upgrade stopped before changing application or licence files; a tested transition is required.');
      exit;
    end;
  end else if DirExists(ExistingDir) or FileExists(Marker) or FileExists(StateFile) then begin
    RefuseUpgrade('Existing licence state has no protected public key. Upgrade stopped; repair and a tested transition are required.');
    exit;
  end;
  Result := True;
#endif
end;

{ The one page this installer adds: a new company or the one already here.

  It defaults to what the disk says - a machine with a KAYAN database gets
  "existing", a clean machine gets "new" - so an unattended install does the
  safe thing, but the customer still sees and confirms the choice. The answer
  is enforced twice: this page decides the words on screen, and
  install-runtime.ps1 refuses either mode when the database on disk disagrees
  with it. }
procedure InitializeWizard;
var
  ExistingCompany: Boolean;
begin
  ExistingCompany := FileExists(ExpandConstant('{commonappdata}\KAYAN-ERP\PostgreSQL\data\PG_VERSION'));
  CompanyPage := CreateInputOptionPage(wpSelectDir,
    ExpandConstant('{cm:CompanyPageCaption}'),
    ExpandConstant('{cm:CompanyPageDescription}'),
    ExpandConstant('{cm:CompanyChoiceHint}'),
    True, False);
  // TInputOptionWizardPage.Add takes the caption alone - it has no slot for a
  // description - so the consequences of both choices sit in the page's
  // sub-caption above, which every language spells out in full.
  CompanyPage.Add(ExpandConstant('{cm:CompanyNew}'));
  CompanyPage.Add(ExpandConstant('{cm:CompanyExisting}'));
  CompanyPage.Values[0] := not ExistingCompany;
  CompanyPage.Values[1] := ExistingCompany;
end;

{ What the runtime setup is told. Read when the answer is used rather than
  when the page is left, so a silent install (where the page is not shown)
  still gets the answer the page would have defaulted to. }
function SelectedCompanyMode: String;
begin
  if CompanyPage <> nil then
  begin
    if CompanyPage.Values[1] then
      Result := 'Existing'
    else
      Result := 'New';
    exit;
  end;
  if FileExists(ExpandConstant('{commonappdata}\KAYAN-ERP\PostgreSQL\data\PG_VERSION')) then
    Result := 'Existing'
  else
    Result := 'New';
end;

function RunPowerShell(const Args: String; var ResultCode: Integer): Boolean;
var
  PowerShell: String;
begin
  PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Result := Exec(PowerShell, Args, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

{ Reads the last thing the runtime setup wrote down, so a failure names the
  step that actually failed instead of only saying "something went wrong". }
function ReadRuntimeResult: String;
var
  ResultFile: String;
  Lines: TArrayOfString;
  Index: Integer;
  Content: String;
begin
  Result := '';
  ResultFile := ExpandConstant('{commonappdata}\KAYAN-ERP\logs\installer-result.txt');
  if FileExists(ResultFile) then
  begin
    if LoadStringsFromFile(ResultFile, Lines) then
    begin
      Content := '';
      for Index := 0 to GetArrayLength(Lines) - 1 do
      begin
        if Content <> '' then
          Content := Content + ' ';
        Content := Content + Lines[Index];
      end;
      Result := Content;
    end;
  end;
  if Result = '' then
    Result := 'Failing step: not recorded.';
end;

{ True only when the runtime setup itself said it finished. A script that
  returns 0 without reaching its last step is not a successful setup, and an
  installation that half finished must not look like one. The last step is
  written only after the database, the settings and the service have all been
  checked from the inside. }
function RuntimeConfirmed: Boolean;
var
  ResultFile: String;
  Lines: TArrayOfString;
  Content: String;
  Index: Integer;
begin
  Result := False;
  ResultFile := ExpandConstant('{commonappdata}\KAYAN-ERP\logs\installer-result.txt');
  if not FileExists(ResultFile) then exit;
  if not LoadStringsFromFile(ResultFile, Lines) then exit;
  Content := '';
  for Index := 0 to GetArrayLength(Lines) - 1 do
    Content := Content + ' ' + Lines[Index];
  Result := Pos('Last completed step: finished', Content) > 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  OldControl: String;
begin
  Result := '';
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM erp_kayan.exe /T /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if FileExists(ExpandConstant('{app}\database-control.ps1')) then begin
    OldControl := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\database-control.ps1') + '" -Action stop';
    if not RunPowerShell(OldControl, ResultCode) then begin
      Result := 'Could not run the existing KAYAN database stop script. Close KAYAN ERP and retry.';
      exit;
    end;
    if ResultCode <> 0 then begin
      Result := 'The existing KAYAN PostgreSQL service could not be stopped. No application files were replaced.';
      exit;
    end;
  end;
end;

function CmdLineParamExists(const Value: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do begin
    if CompareText(ParamStr(I), Value) = 0 then begin
      Result := True;
      Exit;
    end;
  end;
end;

{ Removes the program and keeps company data: the ordinary uninstall. }
function RemoveProgramKeepData(): Boolean;
var
  ResultCode: Integer;
  Args: String;
begin
  Result := True;
  if FileExists(ExpandConstant('{app}\remove-runtime.ps1')) then begin
    Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\remove-runtime.ps1') + '"';
    if (not RunPowerShell(Args, ResultCode)) or (ResultCode <> 0) then begin
      { A plain MsgBox here stalls an unattended uninstall forever, because
        /SUPPRESSMSGBOXES does not answer it. The failure is real and must stop
        the uninstall either way; only the delivering of the news adapts. }
      Log('Removing the KAYAN PostgreSQL service failed with exit code ' + IntToStr(ResultCode) + '.');
      SuppressibleMsgBox('KAYAN could not safely stop and unregister its PostgreSQL service. The program and company data were left in place.', mbError, MB_OK, IDOK);
      Result := False;
    end;
  end;
end;

{ Complete removal. Reached only when the operator passes /REMOVEEVERYTHING,
  which the Start menu entry "Remove everything" does. The ordinary uninstall
  never reaches it, so choosing the normal route cannot destroy data by
  accident. }
function RemoveEverything(): Boolean;
var
  ResultCode: Integer;
  Args: String;
begin
  Result := False;
  if MsgBox(
    'Delete KAYAN ERP and ALL of your company data?' + #13#10#13#10 +
    'This permanently deletes:' + #13#10 +
    '  - the KAYAN database and its PostgreSQL data folder' + #13#10 +
    '  - attachments, images and documents' + #13#10 +
    '  - all local backups and logs' + #13#10 +
    '  - settings and saved passwords' + #13#10 +
    '  - the program, shortcuts, the Windows service and its registry keys' + #13#10#13#10 +
    'This cannot be undone. There is no copy left on this computer.',
    mbError, MB_YESNO) <> IDYES then begin
    MsgBox('Nothing was deleted. KAYAN ERP is still installed.', mbInformation, MB_OK);
    Exit;
  end;
  { A second, differently worded confirmation: one click must never destroy a
    company's books. }
  if MsgBox(
    'Last confirmation.' + #13#10#13#10 +
    'Choose Yes only if you have a backup somewhere else, or you accept that ' +
    'every company record on this computer is lost for good.',
    mbConfirmation, MB_YESNO) <> IDYES then begin
    MsgBox('Nothing was deleted. KAYAN ERP is still installed.', mbInformation, MB_OK);
    Exit;
  end;

  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM erp_kayan.exe /T /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\remove-everything.ps1') + '" -ConfirmRemoval';
  if (not RunPowerShell(Args, ResultCode)) or (ResultCode <> 0) then begin
    MsgBox('Complete removal did not finish. Some KAYAN components could not be deleted, so this uninstall is NOT complete.' + #13#10#13#10 +
      'A report listing each remaining path and the reason was written to:' + #13#10 +
      ExpandConstant('{commonappdata}\KAYAN-ERP-removal-report.json') + #13#10#13#10 +
      'Restart the computer and run "Remove everything" again; it is safe to run more than once.',
      mbError, MB_OK);
    Exit;
  end;
  Result := True;
end;

function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
  Choice: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM erp_kayan.exe /T /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { The ordinary route is preselected. Erasing everything requires the explicit
    Start menu entry, not a mis-click in the standard uninstall dialog. }
  if CmdLineParamExists('/REMOVEEVERYTHING') then begin
    Result := RemoveEverything();
    Exit;
  end;

  { SuppressibleMsgBox, not MsgBox: /SUPPRESSMSGBOXES answers only the former.
    An unattended uninstall used to stop here on an invisible dialog and never
    finish, which is why the offline smoke timed out on run 42901077717. The
    suppressed answer is IDYES, the same as the default button, and it takes the
    keep-data branch: a silent uninstall still never deletes company data. }
  Choice := SuppressibleMsgBox(
    'Remove KAYAN ERP from this computer?' + #13#10#13#10 +
    'Yes  - Remove the program only. Your company data, database, attachments and backups are kept.' + #13#10 +
    'No   - Cancel and change nothing.' + #13#10#13#10 +
    'To also delete all company data permanently, use "Remove everything (delete all data)" from the Start menu.',
    mbConfirmation, MB_YESNO, IDYES);
  if Choice = IDNO then begin
    Result := False;
    Exit;
  end;
  Result := RemoveProgramKeepData();
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Args: String;
begin
  if CurStep = ssPostInstall then begin
    Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\install-runtime.ps1') + '" -UserSettingsPath "' + ExpandConstant('{userappdata}\KAYAN-ERP\kayan.env') + '" -CompanyMode ' + SelectedCompanyMode;
    if not RunPowerShell(Args, ResultCode) then begin
      RuntimeFailed := True;
      RaiseException('Could not start the local database setup, so KAYAN ERP was not prepared. The program files are installed; fix the cause and run "Repair KAYAN ERP" from the Start menu. Diagnostics: ' +
        ExpandConstant('{commonappdata}\KAYAN-ERP\logs\installer.log'));
    end else if ResultCode <> 0 then begin
      RuntimeFailed := True;
      RaiseException('The local database step did not finish, so KAYAN ERP was not opened. ' +
        'No company data was deleted: a database already on this computer is still there, and a new company is only switched to after it has been checked. ' +
        ReadRuntimeResult + ' Full diagnostics: ' + ExpandConstant('{commonappdata}\KAYAN-ERP\logs\installer.log') +
        ' - fix the cause, then run "Repair KAYAN ERP" from the Start menu.');
    end else if not RuntimeConfirmed then begin
      RuntimeFailed := True;
      RaiseException('The local database step reported no error but never reached its last check, so KAYAN ERP is not treated as installed. ' +
        ReadRuntimeResult + ' Full diagnostics: ' + ExpandConstant('{commonappdata}\KAYAN-ERP\logs\installer.log') +
        ' - run "Repair KAYAN ERP" from the Start menu.');
    end;
  end;
end;
