; Legacy definition disabled: it does not enforce the licence build policy.
; Editing source can bypass this guard; release must remain independently gated.
#error "Legacy Windows installer is disabled. Production release is blocked."

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
; The KAYAN logo (Kayan.png at the repository root, rendered by
; tools\generate_icons.py) is the icon of the Setup file itself — the first
; thing a customer sees. The path is relative to this script, so it works on
; any machine that has the repository.
SetupIconFile=..\windows\runner\resources\app_icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; The client and bundled native dependencies target Windows x64 (AMD64).
UseSetupLdr=x64
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
; The program itself needs no administrator rights to run; installing under
; Program Files is what needs them. Everything the program writes at run time
; goes to %APPDATA%, so the installation folder stays read-only and safe.
PrivilegesRequired=admin
; A plain uninstall: the program's settings and logs in %APPDATA% are data, and
; are left alone. The README says where they are.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
; Arabic ships as an *unofficial* Inno Setup translation, so a standard
; installation does not have it. Asking for a file that is not there makes
; ISCC fail outright, which would take the whole installer down with it: the
; language is offered when this machine has it, and the installer is still
; perfectly usable in English when it does not.
#if FileExists(AddBackslash(CompilerPath) + "Languages\Arabic.isl")
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
#endif

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
; The whole assembled folder: program, client runtime, server, libraries,
; portable node.exe, the KAYAN icon files, README.txt. Nothing is left out and
; nothing is fetched.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
; The shortcuts carry the KAYAN icon explicitly (the copy that travels inside
; the package, icons\app_icon.ico), so they keep it even where Windows would
; otherwise fall back to a generic one. The program's own window and taskbar
; icon come from the same artwork, embedded into erp_kayan.exe at build time.
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icons\app_icon.ico"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icons\app_icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Only the empty folder itself; the client's data stays in %APPDATA% on purpose.
Type: dirifempty; Name: "{app}"
