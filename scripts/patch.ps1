<#
.SYNOPSIS
    Antigravity Windows 语言切换与汉化脚本 (支持中英一键切换)
.EXAMPLE
    .\patch.ps1 -Lang zh
    .\patch.ps1 -Lang en
#>
param(
    [ValidateSet('zh', 'en', 'status')]
    [string]$Lang = 'zh',
    [string]$AppDir = '',
    [switch]$NoRestart,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

# 优先通过 Node.js 核心执行
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $cliPath = Join-Path $ProjectRoot 'bin\cli.js'
    $argsList = @($cliPath, $Lang)
    if ($AppDir) {
        $argsList += @('--app-dir', $AppDir)
    }
    if ($NoRestart) {
        $argsList += '--no-restart'
    }
    if ($Force) {
        $argsList += '--force'
    }
    & node $argsList
    exit $LASTEXITCODE
}

# 若无 Node.js 环境，提供纯 PowerShell 降级处理
Write-Host "Node.js not detected in PATH, running standalone PowerShell patcher..." -ForegroundColor Yellow

if (!$AppDir) {
    $localApp = Join-Path $env:LOCALAPPDATA 'Programs\antigravity'
    if (Test-Path $localApp) {
        $AppDir = $localApp
    } else {
        throw "Could not automatically locate Antigravity. Please pass -AppDir <path>"
    }
}

$AsarPath = Join-Path $AppDir 'resources\app.asar'
$ResourcesDir = Join-Path $AppDir 'resources'
$CleanBackupPath = Join-Path $ResourcesDir 'app.asar.clean-backup'

function Stop-AntigravityGracefully {
    param([switch]$ForceKill, [int]$TimeoutSeconds = 20)

    $running = Get-Process -Name Antigravity -ErrorAction SilentlyContinue
    if (-not $running) {
        Write-Host '  Antigravity was not running.'
        return
    }

    if (-not $ForceKill) {
        Write-Host 'Requesting Antigravity to close (waiting for it to save state)...'
        foreach ($proc in $running) {
            try { $null = $proc.CloseMainWindow() } catch { }
        }

        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        while ((Get-Date) -lt $deadline) {
            if (-not (Get-Process -Name Antigravity -ErrorAction SilentlyContinue)) {
                Write-Host '  Antigravity closed cleanly.' -ForegroundColor Green
                return
            }
            Start-Sleep -Milliseconds 500
        }
    }

    Write-Host '  ! Antigravity did not exit in time and will be force-closed; unsaved state may be lost.' -ForegroundColor Yellow
    Get-Process -Name Antigravity,language_server -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
}

if ($Lang -eq 'en') {
    Stop-AntigravityGracefully -ForceKill:$Force

    if (Test-Path $CleanBackupPath) {
        Copy-Item -LiteralPath $CleanBackupPath -Destination $AsarPath -Force
        Write-Host "✓ Successfully restored official English version!" -ForegroundColor Green
    } else {
        $bak = Get-ChildItem -Path $ResourcesDir -Filter 'app.asar.bak-*' | Sort-Object Name | Select-Object -First 1
        if ($bak) {
            Copy-Item -LiteralPath $bak.FullName -Destination $AsarPath -Force
            Write-Host "✓ Restored from backup: $($bak.Name)" -ForegroundColor Green
        } else {
            throw "No clean backup found to restore."
        }
    }
} else {
    # Switch to zh
    $PreloadFragment = Join-Path $ProjectRoot 'src\patches\preload-zhcn.jsfrag'
    $MenuFragment = Join-Path $ProjectRoot 'src\patches\menu-translate.jsfrag'

    Stop-AntigravityGracefully -ForceKill:$Force

    if (!(Test-Path $CleanBackupPath)) {
        Copy-Item -LiteralPath $AsarPath -Destination $CleanBackupPath
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = Join-Path $ResourcesDir "app.asar.bak-$stamp"
    Copy-Item -LiteralPath $AsarPath -Destination $backupPath

    $tmpRoot = Join-Path $env:TEMP "antigravity-zh-patch-$stamp"
    $extractDir = Join-Path $tmpRoot 'app'
    $packedPath = Join-Path $tmpRoot 'app.asar'

    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    npm exec --yes @electron/asar -- extract $AsarPath $extractDir

    $mainPath = Join-Path $extractDir 'dist\main.js'
    $menuPath = Join-Path $extractDir 'dist\menu.js'
    $preloadPath = Join-Path $extractDir 'dist\preload.js'

    $main = [System.IO.File]::ReadAllText($mainPath, [System.Text.Encoding]::UTF8)
    if ($main -notmatch "appendSwitch\('lang'") {
        $needle = "if \(!electron_1\.app\.commandLine\.hasSwitch\('remote-debugging-port'\)\) \{\r?\n    electron_1\.app\.commandLine\.appendSwitch\('remote-debugging-port', '0'\);\r?\n\}"
        $langPatch = @"
if (!electron_1.app.commandLine.hasSwitch('remote-debugging-port')) {
    electron_1.app.commandLine.appendSwitch('remote-debugging-port', '0');
}
if (!electron_1.app.commandLine.hasSwitch('lang')) {
    electron_1.app.commandLine.appendSwitch('lang', 'zh-CN');
}
"@
        $main = [regex]::Replace($main, $needle, $langPatch, 1)
        [System.IO.File]::WriteAllText($mainPath, $main, [System.Text.UTF8Encoding]::new($false))
    }

    $menu = [System.IO.File]::ReadAllText($menuPath, [System.Text.Encoding]::UTF8)
    $menuFrag = [System.IO.File]::ReadAllText($MenuFragment, [System.Text.Encoding]::UTF8)
    if ($menu -notmatch 'translateMenu\(menu\);') {
        $menu = $menu -replace '(\s*)// Re-apply the menu so the change takes effect\.', "`$1translateMenu(menu);`r`n`$1// Re-apply the menu so the change takes effect."
    }
    if ($menu -notmatch 'function translateMenu\(menu\)') {
        $menu = $menu.TrimEnd() + "`r`n`r`n" + $menuFrag + "`r`n"
    }
    [System.IO.File]::WriteAllText($menuPath, $menu, [System.Text.UTF8Encoding]::new($false))

    $preload = [System.IO.File]::ReadAllText($preloadPath, [System.Text.Encoding]::UTF8)
    $preloadFrag = [System.IO.File]::ReadAllText($PreloadFragment, [System.Text.Encoding]::UTF8)
    $existingStart = $preload.IndexOf('const zhCNText = new Map([')
    $updaterStart = $preload.IndexOf('const updaterAPI = {')

    if ($existingStart -ge 0 -and $updaterStart -gt $existingStart) {
        $preload = $preload.Substring(0, $existingStart) + $preloadFrag + "`r`n" + $preload.Substring($updaterStart)
    } elseif ($updaterStart -gt 0) {
        $preload = $preload.Substring(0, $updaterStart) + $preloadFrag + "`r`n" + $preload.Substring($updaterStart)
    } else {
        $preload = $preload + "`r`n`r`n" + $preloadFrag
    }
    [System.IO.File]::WriteAllText($preloadPath, $preload, [System.Text.UTF8Encoding]::new($false))

    npm exec --yes @electron/asar -- pack --unpack-dir "node_modules/chrome-devtools-mcp" $extractDir $packedPath
    Copy-Item -LiteralPath $packedPath -Destination $AsarPath -Force
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "✓ Successfully switched to Chinese!" -ForegroundColor Green
}

if (!$NoRestart) {
    $exe = Join-Path $AppDir 'Antigravity.exe'
    if (Test-Path $exe) {
        Write-Host "Restarting Antigravity..."
        Start-Process -FilePath $exe | Out-Null
    }
}
