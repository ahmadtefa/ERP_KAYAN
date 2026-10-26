#define AppName "KAYAN ERP"
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
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=KAYAN-ERP-Setup-{#AppVersion}-x64
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
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
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\KAYAN ERP"; Filename: "{app}\erp_kayan.exe"; WorkingDir: "{app}"
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

function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
  Args: String;
begin
  Result := True;
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM erp_kayan.exe /T /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if FileExists(ExpandConstant('{app}\remove-runtime.ps1')) then begin
    Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\remove-runtime.ps1') + '"';
    if (not RunPowerShell(Args, ResultCode)) or (ResultCode <> 0) then begin
      MsgBox('KAYAN could not safely stop and unregister its PostgreSQL service. The program and company data were left in place.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Args: String;
begin
  if CurStep = ssPostInstall then begin
    Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\install-runtime.ps1') + '" -UserSettingsPath "' + ExpandConstant('{userappdata}\KAYAN-ERP\kayan.env') + '" -CompanyMode ' + SelectedCompanyMode;
    if not RunPowerShell(Args, ResultCode) then
      RaiseException('Could not start the local database setup, so KAYAN ERP was not prepared. The program files are installed; fix the cause and run "Repair KAYAN ERP" from the Start menu. Diagnostics: ' +
        ExpandConstant('{commonappdata}\KAYAN-ERP\logs\installer.log'))
    else if ResultCode <> 0 then
      RaiseException('The local database step did not finish, so KAYAN ERP was not opened. ' +
        'No company data was deleted: a database already on this computer is still there, and a new company is only switched to after it has been checked. ' +
        ReadRuntimeResult + ' Full diagnostics: ' + ExpandConstant('{commonappdata}\KAYAN-ERP\logs\installer.log') +
        ' - fix the cause, then run "Repair KAYAN ERP" from the Start menu.')
    else if not RuntimeConfirmed then
      RaiseException('The local database step reported no error but never reached its last check, so KAYAN ERP is not treated as installed. ' +
        ReadRuntimeResult + ' Full diagnostics: ' + ExpandConstant('{commonappdata}\KAYAN-ERP\logs\installer.log') +
        ' - run "Repair KAYAN ERP" from the Start menu.')
  end;
end;
