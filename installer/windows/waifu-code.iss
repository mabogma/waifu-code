; Waifu Code Windows user installer. Built with Inno Setup 7.
#ifndef AppSourceDir
  #error AppSourceDir must point to a clean Windows distribution.
#endif
#ifndef InstallerOutputDir
  #error InstallerOutputDir must be specified.
#endif
#ifndef AppVersion
  #define AppVersion "0.4.1"
#endif

[Setup]
AppId={{9E438C45-1BE4-40DE-98C4-3082C2C1F259}
AppName=Waifu Code
AppVersion={#AppVersion}
AppVerName=Waifu Code {#AppVersion}
AppPublisher=Waifu Code
AppPublisherURL=https://github.com/mabogma/waifu-code
AppSupportURL=https://github.com/mabogma/waifu-code/issues
AppUpdatesURL=https://github.com/mabogma/waifu-code/releases
DefaultDirName={localappdata}\Programs\Waifu Code
DefaultGroupName=Waifu Code
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableDirPage=no
DisableProgramGroupPage=no
AllowNoIcons=yes
WizardStyle=modern
WizardImageFile={#AppSourceDir}\waifu-setup-large.bmp
WizardSmallImageFile={#AppSourceDir}\waifu-setup-small.bmp
DisableWelcomePage=no
LicenseFile={#AppSourceDir}\resources\app\LICENSE.txt
SetupIconFile={#AppSourceDir}\resources\app\resources\win32\code.ico
UninstallDisplayIcon={app}\Waifu Code.exe
OutputDir={#InstallerOutputDir}
OutputBaseFilename=WaifuCodeUserSetup-x64-{#AppVersion}
SourceDir={#AppSourceDir}
Compression=lzma2/normal
SolidCompression=yes
LZMAUseSeparateProcess=yes
VersionInfoVersion={#AppVersion}.0
VersionInfoProductName=Waifu Code
VersionInfoDescription=Waifu Code User Setup
SetupMutex=WaifuCodeUserSetup
AppMutex=waifu-code
CloseApplications=yes
RestartApplications=no
ChangesEnvironment=yes
ChangesAssociations=yes
UninstallDisplayName=Waifu Code

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
english.DesktopIcon=Create a desktop shortcut
english.OtherOptions=Additional options:
russian.OtherOptions=Дополнительные параметры:
russian.DesktopIcon=Создать ярлык на рабочем столе
english.AddPath=Add Waifu Code to PATH (available in new terminals)
russian.AddPath=Добавить Waifu Code в PATH (для новых терминалов)
english.FileMenu=Add "Open with Waifu Code" to file context menus
russian.FileMenu=Добавить «Открыть в Waifu Code» в контекстное меню файлов
english.FolderMenu=Add "Open with Waifu Code" to folder context menus
russian.FolderMenu=Добавить «Открыть в Waifu Code» в контекстное меню папок
english.OpenWith=Open with Waifu Code
russian.OpenWith=Открыть в Waifu Code
english.Launch=Launch Waifu Code
russian.Launch=Запустить Waifu Code

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "addtopath"; Description: "{cm:AddPath}"; GroupDescription: "{cm:OtherOptions}"
Name: "filecontext"; Description: "{cm:FileMenu}"; GroupDescription: "{cm:OtherOptions}"; Flags: unchecked
Name: "foldercontext"; Description: "{cm:FolderMenu}"; GroupDescription: "{cm:OtherOptions}"; Flags: unchecked

[Files]
Source: "*"; DestDir: "{app}"; Excludes: "waifu-setup-large.bmp,waifu-setup-small.bmp"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Waifu Code"; Filename: "{app}\Waifu Code.exe"; AppUserModelID: "Waifu.Code"
Name: "{group}\{cm:UninstallProgram,Waifu Code}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Waifu Code"; Filename: "{app}\Waifu Code.exe"; Tasks: desktopicon; AppUserModelID: "Waifu.Code"

[Registry]
Root: HKCU; Subkey: "Software\Classes\*\shell\WaifuCode"; ValueType: string; ValueName: ""; ValueData: "{cm:OpenWith}"; Tasks: filecontext; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\*\shell\WaifuCode"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\Waifu Code.exe"; Tasks: filecontext
Root: HKCU; Subkey: "Software\Classes\*\shell\WaifuCode\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Waifu Code.exe"" ""%1"""; Tasks: filecontext
Root: HKCU; Subkey: "Software\Classes\Directory\shell\WaifuCode"; ValueType: string; ValueName: ""; ValueData: "{cm:OpenWith}"; Tasks: foldercontext; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Directory\shell\WaifuCode"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\Waifu Code.exe"; Tasks: foldercontext
Root: HKCU; Subkey: "Software\Classes\Directory\shell\WaifuCode\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Waifu Code.exe"" ""%V"""; Tasks: foldercontext
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\WaifuCode"; ValueType: string; ValueName: ""; ValueData: "{cm:OpenWith}"; Tasks: foldercontext; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\WaifuCode"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\Waifu Code.exe"; Tasks: foldercontext
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\WaifuCode\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Waifu Code.exe"" ""%V"""; Tasks: foldercontext
Root: HKCU; Subkey: "Software\Classes\waifu-code"; ValueType: string; ValueName: ""; ValueData: "URL:Waifu Code"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\waifu-code"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\waifu-code\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Waifu Code.exe"
Root: HKCU; Subkey: "Software\Classes\waifu-code\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Waifu Code.exe"" --open-url -- ""%1"""
Root: HKCU; Subkey: "Software\WaifuCode\Installer"; Flags: uninsdeletekey

[Run]
Filename: "{app}\Waifu Code.exe"; Description: "{cm:Launch}"; Flags: nowait postinstall skipifsilent

[Code]
const
  InstallerKey = 'Software\WaifuCode\Installer';

function NormalizePath(Value: string): string;
begin
  Value := Trim(Value);
  if (Length(Value) > 1) and (Value[1] = '"') and (Value[Length(Value)] = '"') then
    Value := Copy(Value, 2, Length(Value) - 2);
  while (Length(Value) > 3) and (Value[Length(Value)] = '\') do
    Delete(Value, Length(Value), 1);
  Result := Lowercase(Value);
end;

function HasPathEntry(Value, Entry: string): Boolean;
var
  Part: string;
  Position: Integer;
begin
  Result := False;
  repeat
    Position := Pos(';', Value);
    if Position = 0 then begin Part := Value; Value := ''; end
    else begin Part := Copy(Value, 1, Position - 1); Delete(Value, 1, Position); end;
    if NormalizePath(Part) = NormalizePath(Entry) then begin Result := True; Exit; end;
  until Value = '';
end;

procedure RemoveOwnedPath;
var
  Owned, Entry, Value, Part, Updated, Previous, AddedValue: string;
  Position: Integer;
begin
  if not RegQueryStringValue(HKCU, InstallerKey, 'AddedToPath', Owned) or (Owned <> '1') then Exit;
  if not RegQueryStringValue(HKCU, InstallerKey, 'PathEntry', Entry) then Exit;
  if RegQueryStringValue(HKCU, 'Environment', 'Path', Value) then begin
    if RegQueryStringValue(HKCU, InstallerKey, 'PathAfterInstall', AddedValue) and (Value = AddedValue) and
      RegQueryStringValue(HKCU, InstallerKey, 'PathBeforeInstall', Previous) then begin
      RegWriteExpandStringValue(HKCU, 'Environment', 'Path', Previous);
    end else begin
    Updated := '';
    repeat
      Position := Pos(';', Value);
      if Position = 0 then begin Part := Value; Value := ''; end
      else begin Part := Copy(Value, 1, Position - 1); Delete(Value, 1, Position); end;
      if NormalizePath(Part) <> NormalizePath(Entry) then begin
        if Updated <> '' then Updated := Updated + ';';
        Updated := Updated + Part;
      end;
    until Value = '';
    RegWriteExpandStringValue(HKCU, 'Environment', 'Path', Updated);
    end;
  end;
  RegDeleteValue(HKCU, InstallerKey, 'AddedToPath');
  RegDeleteValue(HKCU, InstallerKey, 'PathEntry');
  RegDeleteValue(HKCU, InstallerKey, 'PathBeforeInstall');
  RegDeleteValue(HKCU, InstallerKey, 'PathAfterInstall');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Value, Entry, Owned, Previous, Before: string;
  AlreadyOwned: Boolean;
begin
  if CurStep <> ssPostInstall then Exit;
  Entry := ExpandConstant('{app}\bin');
  AlreadyOwned := RegQueryStringValue(HKCU, InstallerKey, 'AddedToPath', Owned) and (Owned = '1') and
    RegQueryStringValue(HKCU, InstallerKey, 'PathEntry', Previous) and (NormalizePath(Previous) = NormalizePath(Entry));
  if not WizardIsTaskSelected('addtopath') then begin RemoveOwnedPath; Exit; end;
  if not AlreadyOwned then RemoveOwnedPath;
  RegQueryStringValue(HKCU, 'Environment', 'Path', Value);
  if not HasPathEntry(Value, Entry) then begin
    Before := Value;
    if (Value <> '') and (Copy(Value, Length(Value), 1) <> ';') then Value := Value + ';';
    if RegWriteExpandStringValue(HKCU, 'Environment', 'Path', Value + Entry) then begin
      RegWriteStringValue(HKCU, InstallerKey, 'AddedToPath', '1');
      RegWriteStringValue(HKCU, InstallerKey, 'PathEntry', Entry);
      RegWriteStringValue(HKCU, InstallerKey, 'PathBeforeInstall', Before);
      RegWriteStringValue(HKCU, InstallerKey, 'PathAfterInstall', Value + Entry);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then RemoveOwnedPath;
end;
