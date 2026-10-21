#Requires -Version 5.1
<#
.SYNOPSIS
    Draws the Chrome Web Store promo images from the extension icon and a popup screenshot.
.DESCRIPTION
    Writes Screenshots/webstore/promo-small.png (440x280) and promo-marquee.png (1400x560).
    Run Take-Screenshots.ps1 first, because the popup comes from Screenshots/readme/popup-defaults.png.
    The background is a dithered radial gradient with a soft bloom behind the popup, and the title has
    a blurred drop shadow with slightly tightened letter spacing.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ('PromoBackdrop' -as [type])) {
    # PowerShell 7 splits System.Drawing across two assemblies, 5.1 has one, so reference whichever hold the types.
    $refs = @([Drawing.Bitmap].Assembly.Location, [Drawing.Rectangle].Assembly.Location) | Select-Object -Unique
    Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PromoBackdrop {
    // Radial gradient plus a broad bloom, with triangular noise so 8-bit output doesn't band.
    public static void Fill(Bitmap bmp, float hx, float hy, float hr, float bx, float by, float bw, float bh) {
        int w = bmp.Width, h = bmp.Height;
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        byte[] buf = new byte[data.Stride * h];
        var rng = new Random(7);
        double[] inner = { 40, 104, 184 }, outer = { 9, 26, 50 }, glow = { 110, 160, 235 };
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                double d = Math.Min(1.0, Math.Sqrt((x - hx) * (x - hx) + (y - hy) * (y - hy)) / hr);
                double dx = (x - bx) / bw, dy = (y - by) / bh;
                double e = Math.Exp(-(dx * dx + dy * dy) * 2.0) * 0.30;
                int i = y * data.Stride + x * 4;
                for (int c = 0; c < 3; c++) {
                    double v = inner[c] + (outer[c] - inner[c]) * d;
                    v += (glow[c] - v) * e;
                    v += rng.NextDouble() + rng.NextDouble() - 1.0;
                    buf[i + (2 - c)] = (byte)Math.Max(0, Math.Min(255, Math.Round(v)));
                }
                buf[i + 3] = 255;
            }
        }
        Marshal.Copy(buf, 0, data.Scan0, buf.Length);
        bmp.UnlockBits(data);
    }
}
'@
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$icon = [Drawing.Image]::FromFile((Join-Path $repo 'TabSwitcherExtension\icons\icon128.png'))
$shot = [Drawing.Image]::FromFile((Join-Path $repo 'Screenshots\readme\popup-defaults.png'))
$outDir = Join-Path $repo 'Screenshots\webstore'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$tagline = 'Rotate tabs, refresh pages and auto scroll, with rules for each site'
$titleLines = @("Skilly's Auto", 'Tab Switcher')

# The screenshot has a little page background around the popup, so crop most of it off.
$pad = 8
$crop = New-Object Drawing.Rectangle $pad, $pad, ($shot.Width - 2 * $pad), ($shot.Height - 2 * $pad)

function Add-Popup($g, [float]$X, [float]$Y, [float]$Width) {
    $height = $Width * $crop.Height / $crop.Width
    for ($i = 1; $i -le 10; $i++) {
        $b = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(14, 0, 0, 0))
        $g.FillRectangle($b, ($X - $i), ($Y - $i + 8), ($Width + 2 * $i), ($height + 2 * $i))
        $b.Dispose()
    }
    $dest = New-Object Drawing.RectangleF $X, $Y, $Width, $height
    $source = New-Object Drawing.RectangleF $crop.X, $crop.Y, $crop.Width, $crop.Height
    $g.DrawImage($shot, $dest, $source, [Drawing.GraphicsUnit]::Pixel)
}

# GDI+ has no letter spacing, so place each glyph from the measured width of the text before it.
function Add-Text($g, [string]$Text, $Font, $Brush, [float]$X, [float]$Y, [float]$Tracking) {
    $format = [Drawing.StringFormat]::GenericTypographic.Clone()
    $format.FormatFlags = $format.FormatFlags -bor [Drawing.StringFormatFlags]::MeasureTrailingSpaces
    $origin = New-Object Drawing.PointF 0, 0
    for ($i = 0; $i -lt $Text.Length; $i++) {
        $offset = 0
        if ($i -gt 0) { $offset = $g.MeasureString($Text.Substring(0, $i), $Font, $origin, $format).Width }
        $g.DrawString([string]$Text[$i], $Font, $Brush, ($X + $offset + $i * $Tracking), $Y, $format)
    }
    $format.Dispose()
}

# The shadow is drawn small and scaled up, which blurs it without a stroke or hard edge.
function Add-Title($g, [int]$Width, [int]$Height, $Font, [float]$X, [float]$Y, [float]$Step, [float]$Size) {
    $tracking = -0.015 * $Size
    $scale = 0.25
    $layer = New-Object Drawing.Bitmap ([int]($Width * $scale)), ([int]($Height * $scale))
    $lg = [Drawing.Graphics]::FromImage($layer)
    $lg.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAlias
    $lg.ScaleTransform($scale, $scale)
    $shadow = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(110, 0, 0, 0))
    for ($n = 0; $n -lt $titleLines.Count; $n++) { Add-Text $lg $titleLines[$n] $Font $shadow $X ($Y + $n * $Step) $tracking }
    $g.DrawImage($layer, (New-Object Drawing.Rectangle 0, 4, $Width, $Height))
    $shadow.Dispose(); $lg.Dispose(); $layer.Dispose()
    for ($n = 0; $n -lt $titleLines.Count; $n++) { Add-Text $g $titleLines[$n] $Font ([Drawing.Brushes]::White) $X ($Y + $n * $Step) $tracking }
}

function New-Tile([int]$Width, [int]$Height, [bool]$Wide, [string]$Name) {
    $bmp = New-Object Drawing.Bitmap $Width, $Height
    if ($Wide) { $popupW = 600; $popupX = 740 } else { $popupW = 320; $popupX = ($Width - $popupW) / 2 }
    $popupH = $popupW * $crop.Height / $crop.Width
    if ($Wide) { $popupY = ($Height - $popupH) / 2 } else { $popupY = $Height - $popupH + 36 }
    $cx = $popupX + $popupW / 2
    $cy = $popupY + $popupH / 2
    [PromoBackdrop]::Fill($bmp, $cx, $cy, ([Math]::Sqrt($Width * $Width + $Height * $Height) * 0.7), $cx, $cy, ($popupW * 0.9), ($popupH * 1.1))

    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAlias
    $px = [Drawing.GraphicsUnit]::Pixel

    if ($Wide) {
        $size = 76
        $titleFont = New-Object Drawing.Font 'Segoe UI', $size, ([Drawing.FontStyle]::Bold), $px
        $tagFont = New-Object Drawing.Font 'Segoe UI', 32, ([Drawing.FontStyle]::Regular), $px
        $g.DrawImage($icon, 80, 70, 112, 112)
        Add-Title $g $Width $Height $titleFont 80 190 ($size * 1.02) $size
        $g.DrawString($tagline, $tagFont, [Drawing.Brushes]::White, (New-Object Drawing.RectangleF 80, 395, 620, 110))
        $tagFont.Dispose()
    }
    else {
        $size = 40
        $titleFont = New-Object Drawing.Font 'Segoe UI', $size, ([Drawing.FontStyle]::Bold), $px
        $g.DrawImage($icon, 22, 20, 80, 80)
        Add-Title $g $Width $Height $titleFont 114 14 ($size * 1.02) $size
    }
    Add-Popup $g $popupX $popupY $popupW

    $path = Join-Path $outDir $Name
    $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    $titleFont.Dispose(); $g.Dispose(); $bmp.Dispose()
    Write-Host "Wrote $path"
}

try {
    New-Tile 440 280 $false 'promo-small.png'
    New-Tile 1400 560 $true 'promo-marquee.png'
}
finally {
    $icon.Dispose()
    $shot.Dispose()
}
