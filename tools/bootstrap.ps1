param([string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$root = if ($ProjectRoot) { $ProjectRoot } else { Split-Path $PSScriptRoot -Parent }
$node = Get-Command node -ErrorAction Stop
$npm = Get-Command npm.cmd -ErrorAction Stop
& $node.Source --version
Push-Location (Join-Path $root 'app')
try {
    & $npm.Source ci
    if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }
} finally { Pop-Location }
$cache = Join-Path $root '.tools'
$webview = Join-Path $cache 'webview2'
if (-not (Test-Path (Join-Path $webview 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'))) {
    [void][IO.Directory]::CreateDirectory($cache)
    $uri = 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.2903.40/microsoft.web.webview2.1.0.2903.40.nupkg'
    $archive = Join-Path $cache 'webview2.zip'
    Invoke-WebRequest $uri -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $webview -Force
}
Write-Output 'INKLET_BOOTSTRAP_OK'
