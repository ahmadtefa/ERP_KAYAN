; KAYAN ERP - the Windows installer definition.
;
; This file is data, not a program: the Inno Setup compiler (ISCC) reads it and
; produces the single file a customer runs:
;
;     KAYAN-ERP-Setup-<version>.exe
;
; The customer double-clicks that file, sees the usual Windows installer, and
; ends up with ERP_KAYAN in the Start menu. Nothing else is installed, nothing
; is downloaded, and no Node.js, Flutter, Git or terminal is involved.
;
; It packs the folder that scripts\build-desktop-windows.ps1 has already
; assembled (build\desktop\KAYAN-ERP), so the two steps stay separate: the build
; script decides WHAT ships, this file decides how it is installed.
;
; Inno Setup is free, is the standard for this job, and leaves no runtime
; dependency behind. The build script runs ISCC automatically when it is
; installed, and simply skips the installer when it is not.

#define AppName "KAYAN ERP"
#define AppShortName "ERP_KAYAN"
#define AppExe "erp_kayan.exe"
#define AppVersion "1.0.0"
#define AppPublisher "KAYAN"
; Both are passed in by scripts\build-desktop-windows.ps1, so a custom -Output
; folder stays in step. The values below are used when ISCC is run by hand.
#ifndef SourceDir
  #define SourceDir "..\build\desktop\KAYAN-ERP"
#endif
#ifndef OutputDir
  #define OutputDir "..\build\desktop"
#endif

[Setup]
AppId={{8F1C4A62-9B7E-4D51-9C3A-7E2B5D6A1F30}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=KAYAN-ERP-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; The client is a 64-bit Flutter build and the server ships a 64-bit node.exe.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; The program itself needs no administrator rights to run; installing under
; Program Files is what needs them. Everything the program writes at run time
; goes to %APPDATA%, so the installation folder stays read-only and safe.
PrivilegesRequired=admin
; A plain uninstall: the program's settings and logs in %APPDATA% are data, and
; are left alone. The README says where they are.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
; The whole assembled folder: program, client runtime, server, libraries,
; portable node.exe, README.txt. Nothing is left out and nothing is fetched.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Only the empty folder itself; the client's data stays in %APPDATA% on purpose.
Type: dirifempty; Name: "{app}"
