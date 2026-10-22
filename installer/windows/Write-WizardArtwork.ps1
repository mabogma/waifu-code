param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$logo = [Drawing.Image]::FromFile((Join-Path $Directory 'waifu-code.png'))
$large = [Drawing.Bitmap]::new(231, 393)
$graphics = [Drawing.Graphics]::FromImage($large)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$background = [Drawing.Drawing2D.LinearGradientBrush]::new([Drawing.Point]::new(0,0), [Drawing.Point]::new(231,393), [Drawing.Color]::FromArgb(29,22,40), [Drawing.Color]::FromArgb(70,42,80))
$pink = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(243,187,225))
$light = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(210,188,221))
$title = [Drawing.Font]::new('Segoe UI', 27, [Drawing.FontStyle]::Bold)
$subtitle = [Drawing.Font]::new('Segoe UI', 9)
try {
	$graphics.FillRectangle($background, 0, 0, 231, 393)
	$graphics.DrawImage($logo, 47, 51, 137, 137)
	$graphics.DrawString("Waifu`nCode", $title, $pink, 29, 209)
	$graphics.DrawString('Your coding universe.', $subtitle, $light, 30, 338)
	$large.Save((Join-Path $Directory 'waifu-setup-large.bmp'), [Drawing.Imaging.ImageFormat]::Bmp)
} finally { $graphics.Dispose(); $large.Dispose(); $background.Dispose(); $pink.Dispose(); $light.Dispose(); $title.Dispose(); $subtitle.Dispose() }
$small = [Drawing.Bitmap]::new(55,55)
$graphics = [Drawing.Graphics]::FromImage($small)
try {
	$graphics.Clear([Drawing.Color]::White)
	$graphics.DrawImage($logo, 5, 5, 45, 45)
	$small.Save((Join-Path $Directory 'waifu-setup-small.bmp'), [Drawing.Imaging.ImageFormat]::Bmp)
} finally { $graphics.Dispose(); $small.Dispose(); $logo.Dispose() }
