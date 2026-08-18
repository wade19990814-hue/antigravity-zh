<#
.SYNOPSIS
    Antigravity 语言切换与汉化脚本（Windows 便捷入口）
.DESCRIPTION
    这是 Node.js CLI 的一层薄封装。翻译内容由 src/locales/<code>.json 定义，
    补丁片段在运行时由 Node 构建，因此本脚本要求已安装 Node.js (>= 16)。
.EXAMPLE
    .\patch.ps1 -Lang zh
    .\patch.ps1 -Lang en
    .\patch.ps1 -Lang zh -Locale zh-CN -Force
#>
param(
    [ValidateSet('zh', 'en', 'status', 'locales')]
    [string]$Lang = 'zh',
    [string]$AppDir = '',
    [string]$Locale = '',
    [switch]$NoRestart,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error @'
Node.js (>= 16) is required but was not found in PATH.

Install it from https://nodejs.org/ and re-run this script, or use npx directly:
    npx antigravity-zh zh
'@
    exit 1
}

$cliPath = Join-Path $ProjectRoot 'bin\cli.js'
$argsList = @($cliPath, $Lang)
if ($AppDir) {
    $argsList += @('--app-dir', $AppDir)
}
if ($Locale) {
    $argsList += @('--locale', $Locale)
}
if ($NoRestart) {
    $argsList += '--no-restart'
}
if ($Force) {
    $argsList += '--force'
}

& node $argsList
exit $LASTEXITCODE
