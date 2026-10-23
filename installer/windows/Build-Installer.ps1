param(
	[Parameter(Mandatory=$true)][string]$ApplicationDirectory,
	[string]$CompilerPath = 'C:\Program Files (x86)\Inno Setup 7\ISCC.exe',
	[ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version = '0.4.3',
	[string]$OutputDirectory,
	[string]$PreparedDirectory
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$application = (Resolve-Path -LiteralPath $ApplicationDirectory).Path
if (-not (Test-Path -LiteralPath $CompilerPath)) { throw "Inno Setup compiler not found: $CompilerPath" }
if (-not (Test-Path -LiteralPath (Join-Path $application 'Waifu Code.exe'))) { throw 'Waifu Code.exe is missing' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repository 'artifacts' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
if ($PreparedDirectory) {
	$stage = (Resolve-Path -LiteralPath $PreparedDirectory).Path
	$allowed = [IO.Path]::GetFullPath((Join-Path $repository 'work')) + [IO.Path]::DirectorySeparatorChar
	if (-not $stage.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($stage) -notlike 'installer-stage-*') { throw 'Prepared directory must be an installer-stage folder under this repository work directory' }
} else {
	$stage = Join-Path $repository ('work/installer-stage-' + [guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $stage -Force | Out-Null
	Write-Output 'Preparing a clean Windows distribution (excluding portable user data)...'
	$copyLog = Join-Path $stage 'copy.log'
	& robocopy.exe $application $stage /E /COPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XJ /XD (Join-Path $application 'data') (Join-Path $application 'resources/app/node-compile-cache') (Join-Path $application 'resources/app/extensions/waifu-addons/test') /XF codium codium.cmd /LOG:$copyLog | Out-Null
	if ($LASTEXITCODE -ge 8) { throw "Copy failed; see $copyLog" }
	Remove-Item -LiteralPath $copyLog -Force
}
if (Test-Path -LiteralPath (Join-Path $stage 'data')) { throw 'Portable user data must never enter the installer' }
$unexpected = Get-ChildItem -LiteralPath $stage -Recurse -File -Force | Where-Object { $_.Name -like '*-token.txt' -or $_.FullName -match '[\\/]\.private[\\/]' }
if ($unexpected) { throw 'Unexpected publisher token or private directory in payload' }
$productPath = Join-Path $stage 'resources/app/product.json'
$product = Get-Content -LiteralPath $productPath -Raw | ConvertFrom-Json
if ($product.nameShort -ne 'Waifu Code' -or $product.win32MutexName -ne 'waifu-code') { throw 'Unexpected product identity in installer payload' }
# The runtime creates its Windows install mutex only for Inno user/system targets.
$product | Add-Member -NotePropertyName target -NotePropertyValue 'user' -Force
[IO.File]::WriteAllText($productPath, ($product | ConvertTo-Json -Depth 100) + [Environment]::NewLine)
$metadataPath = Join-Path $stage 'WAIFU-BUILD.json'
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$metadata | Add-Member -NotePropertyName distributionVersion -NotePropertyValue $Version -Force
$metadata | Add-Member -NotePropertyName packageType -NotePropertyValue 'windows-user-setup' -Force
[IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 10) + [Environment]::NewLine)
$readme = @'
WAIFU CODE — WINDOWS USER SETUP

Launch Waifu Code from the Start menu or the desktop shortcut if selected.
Use waifu-code in a NEW terminal if the PATH option was selected.
User settings and addons live in your user profile, outside the installation folder.
Uninstall from Windows Settings > Apps. Uninstall does not delete your profile.
Waifu Addons is available from the heart sidebar. Registry: http://132.243.115.51:4853.
Source and releases: https://github.com/mabogma/waifu-code

Based on the official VSCodium Windows binary; this is not a compiled binary of
the separate Code OSS development snapshot. See WAIFU-BUILD.json for provenance.
Original licenses and third-party notices are included in resources/app.
'@
[IO.File]::WriteAllText((Join-Path $stage 'README-WAIFU.txt'), $readme)
[IO.File]::WriteAllText((Join-Path $stage 'README-WAIFU.md'), $readme)
[IO.File]::WriteAllText((Join-Path $stage 'BUILD-STATUS.md'), $readme)
$manifest = Get-Content -LiteralPath (Join-Path $stage 'resources/app/extensions/waifu-addons/package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw 'Unexpected addon manager version in release payload' }
Write-Output 'Compiling the Windows installer...'
& (Join-Path $PSScriptRoot 'Write-WizardArtwork.ps1') -Directory $stage
& $CompilerPath "/DAppSourceDir=$stage" "/DInstallerOutputDir=$OutputDirectory" "/DAppVersion=$Version" (Join-Path $PSScriptRoot 'waifu-code.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }
$installer = Join-Path $OutputDirectory "WaifuCodeUserSetup-x64-$Version.exe"
if (-not (Test-Path -LiteralPath $installer)) { throw 'Installer output is missing' }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'SHA256SUMS.txt'), "$hash  $([IO.Path]::GetFileName($installer))`n")
Write-Output "Installer: $installer"
Write-Output "SHA256: $hash"
Write-Output "Clean staged app: $stage"
