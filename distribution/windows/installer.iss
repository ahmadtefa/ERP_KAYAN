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

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\KAYAN ERP"; Filename: "{app}\erp_kayan.exe"; WorkingDir: "{app}"
Name: "{group}\Start PostgreSQL"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\database-control.ps1"" -Action start"; WorkingDir: "{app}"
Name: "{group}\Stop PostgreSQL"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\database-control.ps1"" -Action stop"; WorkingDir: "{app}"
Name: "{group}\Restart PostgreSQL"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\database-control.ps1"" -Action restart"; WorkingDir: "{app}"
Name: "{autodesktop}\KAYAN ERP"; Filename: "{app}\erp_kayan.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\erp_kayan.exe"; Description: "Launch KAYAN ERP"; Flags: postinstall nowait skipifsilent runasoriginaluser

[UninstallDelete]
Type: dirifempty; Name: "{app}"

[Code]
function RunPowerShell(const Args: String; var ResultCode: Integer): Boolean;
var
  PowerShell: String;
begin
  PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Result := Exec(PowerShell, Args, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
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
    Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\install-runtime.ps1') + '" -UserSettingsPath "' + ExpandConstant('{userappdata}\KAYAN-ERP\kayan.env') + '"';
    if not RunPowerShell(Args, ResultCode) then
      RaiseException('Could not start the local PostgreSQL setup. Check permissions and the installer log.')
    else if ResultCode <> 0 then
      RaiseException('KAYAN PostgreSQL setup failed. Existing company data was not deleted; use the diagnostics in README.txt.')
  end;
end;
