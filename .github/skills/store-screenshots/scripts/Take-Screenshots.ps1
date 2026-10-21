#Requires -Version 5.1
<#
.SYNOPSIS
    Renders the extension's popup and rules page with sample data and saves README and store screenshots.
.DESCRIPTION
    Copies TabSwitcherExtension to a temp folder, injects assets/mock.js (fake chrome.* APIs with sample
    settings), renders each page in headless Edge or Chrome, then writes:
      Screenshots/readme/screenshot.png   Popup with out-of-box settings, light/dark diagonal split, used by the README
      Screenshots/readme/popup-light.png  Popup with a page rule, unframed, used by the README
      Screenshots/readme/popup-dark.png
      Screenshots/readme/popup-defaults.png  Out-of-box popup, unframed, light theme
      Screenshots/webstore/popup-light.png       1280x800 store screenshots
      Screenshots/webstore/popup-dark.png
      Screenshots/webstore/popup-defaults.png    Out-of-box settings, no rules, timer stopped
      Screenshots/webstore/rules-light.png
      Screenshots/webstore/rules-edit-dark.png
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
    function Measure-PopupHeight([string]$Query, [int]$Width) {
        $probe = [Drawing.Bitmap]::FromFile((Save-Shot $Query 'measure.png' $Width 1000))
        $height = $probe.Height
        while ($height -gt 1) {
            $pixel = $probe.GetPixel([int]($Width / 2), $height - 1)
            if (-not ($pixel.R -eq 255 -and $pixel.G -eq 0 -and $pixel.B -eq 255)) { break }
            $height--
        }
        $probe.Dispose()
        $height
    }

    # defaults=1 shows the collapsed popup, which is 520px wide plus 15px padding on each side.
    $popupWidth = 550
    $popupHeight = Measure-PopupHeight 'popup.html?theme=light&defaults=1&measure=1' $popupWidth

    # The expanded popup (page rule shown) is 700px wide plus padding.
    $ruleWidth = 730
    $ruleHeight = Measure-PopupHeight 'popup.html?theme=light&open=page&measure=1' $ruleWidth
    $darkTab = [uri]::EscapeDataString('https://status.example.com/overview')
    $darkState = "tab=$darkTab&open=site&paused=1"
    $readmePopups = @(
        Save-Shot 'popup.html?theme=light&open=page' 'readme-popup-light.png' $ruleWidth $ruleHeight
        Save-Shot "popup.html?theme=dark&$darkState" 'readme-popup-dark.png' $ruleWidth $ruleHeight
    )

    $rawLight = Save-Shot 'popup.html?theme=light&defaults=1' 'raw-light.png' $popupWidth $popupHeight
    $rawDark = Save-Shot 'popup.html?theme=dark&defaults=1' 'raw-dark.png' $popupWidth $popupHeight
    $editKey = [uri]::EscapeDataString('page:https://github.com/bryceforsm/skillys-auto-tab-switcher')
    $store = @(
        Save-Shot 'popup.html?theme=light&frame=1&open=page' 'popup-light.png'
        Save-Shot "popup.html?theme=dark&frame=1&$darkState" 'popup-dark.png'
        Save-Shot 'popup.html?theme=light&frame=1&defaults=1' 'popup-defaults.png'
        Save-Shot 'rules.html?theme=light&zoom=1.3' 'rules-light.png'
        Save-Shot "rules.html?theme=dark&zoom=1.3&edit=$editKey" 'rules-edit-dark.png'
    )

    $light = [Drawing.Image]::FromFile($rawLight)
    $dark = [Drawing.Image]::FromFile($rawDark)
    $split = New-Object Drawing.Bitmap $popupWidth, $popupHeight
    $g = [Drawing.Graphics]::FromImage($split)
    $g.DrawImage($light, 0, 0, $popupWidth, $popupHeight)
    # Dark theme fills the bottom-left triangle, matching the original README image.
    # The outer points sit past the image edges so only the diagonal gets anti-aliased.
    $points = [Drawing.Point[]]@(
        (New-Object Drawing.Point -1, -1),
        (New-Object Drawing.Point ([int]($popupWidth * 0.24)), -1),
        (New-Object Drawing.Point ([int]($popupWidth * 0.63)), ($popupHeight + 1)),
        (New-Object Drawing.Point -1, ($popupHeight + 1)))
    # Clip regions are never anti-aliased, but a filled polygon is, so paint the dark half as a texture.
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $brush = New-Object Drawing.TextureBrush $dark
    $g.FillPolygon($brush, $points)
    $brush.Dispose()
    # A light 1px frame on every edge of the dark half, so it reads as a border on dark backgrounds.
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::None
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $path.AddPolygon($points)
    $g.SetClip($path)
    $pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(143, 144, 145)), 1
    $g.DrawRectangle($pen, 0, 0, $popupWidth - 1, $popupHeight - 1)
    $pen.Dispose()
    $g.ResetClip()
    $path.Dispose()
    $g.Dispose()
    $light.Dispose()
    $dark.Dispose()

    $readme = Join-Path $repo 'Screenshots\readme'
    New-Item -ItemType Directory -Path $readme -Force | Out-Null
    $split.Save((Join-Path $readme 'screenshot.png'), [Drawing.Imaging.ImageFormat]::Png)
    $split.Dispose()
    Copy-Item -LiteralPath $readmePopups[0] -Destination (Join-Path $readme 'popup-light.png') -Force
    Copy-Item -LiteralPath $readmePopups[1] -Destination (Join-Path $readme 'popup-dark.png') -Force
    Copy-Item -LiteralPath $rawLight -Destination (Join-Path $readme 'popup-defaults.png') -Force

    $screens = Join-Path $repo 'Screenshots\webstore'
    New-Item -ItemType Directory -Path $screens -Force | Out-Null
    Copy-Item -LiteralPath $store -Destination $screens -Force

    Write-Host "Popup measured at ${popupWidth}x$popupHeight."
    Write-Host 'Wrote Screenshots/readme/*.png and Screenshots/webstore/*.png.'
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
