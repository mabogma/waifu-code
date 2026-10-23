param([Parameter(Mandatory=$true)][string]$Installer, [string]$NodeExecutable = 'node', [string]$RegistryUrl = 'http://132.243.115.51:4853', [string]$Version = '0.4.2', [switch]$SkipEditor)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
New-Item -ItemType Directory -Path (Join-Path $workspace 'work') -Force | Out-Null
$install = Join-Path $workspace ('work/waifu-installed-test-' + [guid]::NewGuid().ToString('N'))
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{9E438C45-1BE4-40DE-98C4-3082C2C1F259}_is1'
$keys = @($uninstallKey,'HKCU:\Software\Classes\*\shell\WaifuCode','HKCU:\Software\Classes\Directory\shell\WaifuCode','HKCU:\Software\Classes\Directory\Background\shell\WaifuCode','HKCU:\Software\Classes\waifu-code','HKCU:\Software\WaifuCode\Installer')
foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { throw "Existing Waifu installation state found; refusing to replace it for a test: $key" } }
$desktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Waifu Code.lnk'
$group = 'Waifu Code Installer Test ' + [guid]::NewGuid().ToString('N')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) $group
$testDesktop = -not (Test-Path -LiteralPath $desktop)
if (Test-Path -LiteralPath $menu) { throw 'Existing Waifu test menu found' }
$pathBefore = [Environment]::GetEnvironmentVariable('Path','User')
$tasks = 'addtopath,filecontext,foldercontext'
if ($testDesktop) { $tasks = 'desktopicon,' + $tasks }
$arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOCLOSEAPPLICATIONS','/LANG=russian',('/GROUP="'+$group+'"'),('/TASKS="'+$tasks+'"'),('/DIR="'+$install+'"'),('/LOG="'+(Join-Path $workspace 'work/waifu-install.log')+'"'))
$process = Start-Process -FilePath (Resolve-Path -LiteralPath $Installer).Path -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode). See work/waifu-install.log" }
$installed = Get-ItemProperty -LiteralPath $uninstallKey
if ($installed.DisplayName -ne 'Waifu Code' -or $installed.DisplayVersion -ne $Version) { throw 'Incorrect uninstall metadata' }
if (-not (Test-Path -LiteralPath (Join-Path $install 'Waifu Code.exe'))) { throw 'Installed editor missing' }
if (Test-Path -LiteralPath (Join-Path $install 'data')) { throw 'Portable data leaked into installation' }
if ($testDesktop -and -not (Test-Path -LiteralPath $desktop)) { throw 'Desktop shortcut missing' }
if (-not (Test-Path -LiteralPath (Join-Path $menu 'Waifu Code.lnk'))) { throw 'Start Menu shortcut missing' }
$pathAfter = [Environment]::GetEnvironmentVariable('Path','User')
if ($pathAfter -notlike ('*'+(Join-Path $install 'bin')+'*')) { throw 'PATH entry missing' }
foreach ($key in $keys) { if (-not (Test-Path -LiteralPath $key)) { throw "Installer registry entry missing: $key" } }
$command = (Get-Item -LiteralPath 'HKCU:\Software\Classes\*\shell\WaifuCode\command').GetValue('')
if (-not $command.Contains((Join-Path $install 'Waifu Code.exe'))) { throw 'Incorrect context menu target' }
Write-Output 'Install passed: app, per-user registration, shortcuts, PATH, file/folder menus and clean payload.'
& (Join-Path $install 'bin/waifu-code.cmd') --version
if ($LASTEXITCODE -ne 0) { throw 'Installed CLI failed' }
$env:WAIFU_LIVE_REGISTRY_URL=$RegistryUrl
if (-not $SkipEditor) {
	& $NodeExecutable (Join-Path $workspace 'waifu-code/scripts/waifu-smoke.cjs') $install
	if ($LASTEXITCODE -ne 0) { throw 'Installed editor integration test failed' }
}
# Electron helpers and antivirus scanning can retain image sections briefly after
# the main process exits. Wait for the actual installed binaries to become idle.
$ready = $false
$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
	try {
		foreach ($name in @('Waifu Code.exe','ffmpeg.dll')) {
			$stream = [IO.File]::Open((Join-Path $install $name),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
			$stream.Dispose()
		}
		$ready = $true
	} catch { Start-Sleep -Milliseconds 500 }
} until ($ready -or [DateTime]::UtcNow -gt $deadline)
if (-not $ready) { throw 'Installed Electron binaries are still in use after test shutdown' }
Start-Sleep -Seconds 2
$uninstaller = Join-Path $install 'unins000.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="'+(Join-Path $workspace 'work/waifu-uninstall.log')+'"')) -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { throw "Registry entry left behind: $key" } }
if (($testDesktop -and (Test-Path -LiteralPath $desktop)) -or (Test-Path -LiteralPath (Join-Path $menu 'Waifu Code.lnk'))) { throw 'Shortcuts left behind' }
if ([Environment]::GetEnvironmentVariable('Path','User') -cne $pathBefore) { throw 'User PATH was not restored exactly' }
if (Test-Path -LiteralPath (Join-Path $install 'Waifu Code.exe')) { throw 'Editor binary left behind' }
Write-Output 'Uninstall passed: app, shortcuts and owned registry entries removed; original user PATH restored.'
$checks = @('install','shortcuts','path','context-menus','clean-payload','cli','uninstall','restore-path')
if (-not $SkipEditor) { $checks += @('native-editor-and-addon-api','live-registry') }
$receipt = @{ passed=$true; sha256=(Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant(); checks=$checks }
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $workspace 'work/waifu-installer-test-result.json') -Encoding utf8
