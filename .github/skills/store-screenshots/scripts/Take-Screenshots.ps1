#Requires -Version 5.1
<#
.SYNOPSIS
    Renders the extension's popup and rules page with sample data and saves README and store screenshots.
.DESCRIPTION
    Copies TabSwitcherExtension to a temp folder, injects assets/mock.js (fake chrome.* APIs with sample
    settings), renders each page in headless Edge or Chrome, then writes:
      Misc/screenshot.png              Popup with out-of-box settings, light/dark diagonal split, used by the README
      Misc/screenshot640x400.jpeg      Same image letterboxed to 640x400 for the store
      Screenshot/popup-light.png       1280x800 store screenshots
      Screenshot/popup-dark.png
      Screenshot/popup-defaults.png    Out-of-box settings, no rules, timer stopped
      Screenshot/rules-light.png
      Screenshot/rules-edit-dark.png
    Nothing in TabSwitcherExtension is modified.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$browser = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw 'Microsoft Edge or Google Chrome is required.' }

$work = Join-Path ([IO.Path]::GetTempPath()) "tabshots-$PID"
$out = Join-Path $work 'out'
New-Item -ItemType Directory -Path $out -Force | Out-Null
Copy-Item -Path (Join-Path $repo 'TabSwitcherExtension\*') -Destination $work -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\assets\mock.js') -Destination $work
foreach ($page in 'popup.html', 'rules.html') {
    $file = Join-Path $work $page
    $html = [IO.File]::ReadAllText($file)
    $html = $html.Replace('<script src="theme.js"></script>', '<script src="mock.js"></script><script src="theme.js"></script>')
    [IO.File]::WriteAllText($file, $html)
}
$base = 'file:///' + ($work -replace '\\', '/')

# Start-Process joins arguments with spaces, so paths need their own quotes there but not in a direct call.
function Get-BrowserArgs([int]$Width, [int]$Height, [string]$Quote = '') {
    @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files',
      "--user-data-dir=$Quote$work\profile$Quote", "--window-size=$Width,$Height", '--virtual-time-budget=3000')
}
function Save-Shot([string]$Query, [string]$Name, [int]$Width = 1280, [int]$Height = 800) {
    $path = Join-Path $out $Name
    $arguments = (Get-BrowserArgs $Width $Height '"') + @("--screenshot=`"$path`"", "`"$base/$Query`"")
    Start-Process -FilePath $browser -ArgumentList $arguments -Wait -WindowStyle Hidden
    if (-not (Test-Path -LiteralPath $path)) { throw "Screenshot failed: $Name" }
    $path
}

try {
    Add-Type -AssemblyName System.Drawing

    # The popup's height depends on which rows are visible, so measure it instead of hard-coding it.
    $popupWidth = 730
    $probe = [Drawing.Bitmap]::FromFile((Save-Shot 'popup.html?theme=light&defaults=1&measure=1' 'measure.png' $popupWidth 1000))
    $popupHeight = $probe.Height
    while ($popupHeight -gt 1) {
        $pixel = $probe.GetPixel([int]($popupWidth / 2), $popupHeight - 1)
        if (-not ($pixel.R -eq 255 -and $pixel.G -eq 0 -and $pixel.B -eq 255)) { break }
        $popupHeight--
    }
    $probe.Dispose()

    $rawLight = Save-Shot 'popup.html?theme=light&defaults=1' 'raw-light.png' $popupWidth $popupHeight
    $rawDark = Save-Shot 'popup.html?theme=dark&defaults=1' 'raw-dark.png' $popupWidth $popupHeight
    $editKey = [uri]::EscapeDataString('page:https://github.com/bryceforsm/skillys-auto-tab-switcher')
    $store = @(
        Save-Shot 'popup.html?theme=light&frame=1' 'popup-light.png'
        Save-Shot 'popup.html?theme=dark&frame=1' 'popup-dark.png'
        Save-Shot 'popup.html?theme=light&frame=1&defaults=1' 'popup-defaults.png'
        Save-Shot 'rules.html?theme=light' 'rules-light.png'
        Save-Shot "rules.html?theme=dark&edit=$editKey" 'rules-edit-dark.png'
    )

    $light = [Drawing.Image]::FromFile($rawLight)
    $dark = [Drawing.Image]::FromFile($rawDark)
    $split = New-Object Drawing.Bitmap $popupWidth, $popupHeight
    $g = [Drawing.Graphics]::FromImage($split)
    $g.DrawImage($light, 0, 0, $popupWidth, $popupHeight)
    # Dark theme fills the bottom-left triangle, matching the original README image.
    $points = [Drawing.Point[]]@(
        (New-Object Drawing.Point 0, 0),
        (New-Object Drawing.Point ([int]($popupWidth * 0.07)), 0),
        (New-Object Drawing.Point ([int]($popupWidth * 0.80)), $popupHeight),
        (New-Object Drawing.Point 0, $popupHeight))
    # Clip regions are never anti-aliased, but a filled polygon is, so paint the dark half as a texture.
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $brush = New-Object Drawing.TextureBrush $dark
    $g.FillPolygon($brush, $points)
    $brush.Dispose()
    $g.Dispose()
    $light.Dispose()
    $dark.Dispose()

    $misc = Join-Path $repo 'Misc'
    $split.Save((Join-Path $misc 'screenshot.png'), [Drawing.Imaging.ImageFormat]::Png)

    $small = New-Object Drawing.Bitmap 640, 400
    $g = [Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([Drawing.Color]::FromArgb(238, 238, 238))
    $scale = [Math]::Min(640 / $popupWidth, 400 / $popupHeight)
    $w = [int]($popupWidth * $scale)
    $h = [int]($popupHeight * $scale)
    $g.DrawImage($split, [int]((640 - $w) / 2), [int]((400 - $h) / 2), $w, $h)
    $g.Dispose()
    $jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $quality = New-Object Drawing.Imaging.EncoderParameters 1
    $quality.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 92L
    $small.Save((Join-Path $misc 'screenshot640x400.jpeg'), $jpeg, $quality)
    $small.Dispose()
    $split.Dispose()

    $screens = Join-Path $repo 'Screenshot'
    New-Item -ItemType Directory -Path $screens -Force | Out-Null
    Copy-Item -LiteralPath $store -Destination $screens -Force

    Write-Host "Popup measured at ${popupWidth}x$popupHeight."
    Write-Host 'Wrote Misc/screenshot.png, Misc/screenshot640x400.jpeg and Screenshot/*.png.'
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
