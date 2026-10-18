param([string]$ProjectRoot, [switch]$SkipWeb, [ValidatePattern('^Inklet(?:-[0-9]+\.[0-9]+\.[0-9]+)?$')][string]$ReleaseName)
$ErrorActionPreference = 'Stop'
trap { Write-Output ($_ | Out-String); exit 1 }
$root = if ($ProjectRoot) { $ProjectRoot } else { Split-Path $PSScriptRoot -Parent }
if (-not $ReleaseName) { $ReleaseName = 'Inklet-' + (Get-Content -LiteralPath (Join-Path $root 'app/package.json') -Raw | ConvertFrom-Json).version }
$variant = $ReleaseName
$webOutput = 'dist'
$mode = 'production'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } else { throw 'Install Node.js 24 LTS and run tools/bootstrap.ps1 first.' }
$env:Path = (Split-Path $node) + ';' + $env:Path
if (-not $SkipWeb) {
    Push-Location "$root\app"
    try {
        & $node "$root\app\node_modules\vite\bin\vite.js" build --logLevel warn --mode $mode --outDir $webOutput
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed: $LASTEXITCODE" }
    } finally { Pop-Location }
    Write-Output 'INKLET_WEB_BUILD_OK'
}
$release = Join-Path (Join-Path $root 'release') $variant
if (Get-Process Inklet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $release 'Inklet.exe') }) { throw 'Save your documents and close the running Inklet window before rebuilding.' }
[void][IO.Directory]::CreateDirectory($release)
$web = Join-Path $release 'web'
if (Test-Path $web) { Remove-Item $web -Recurse -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$resources = Join-Path $release 'Inklet.resources'
if (Test-Path $resources) { Remove-Item $resources -Force }
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $root ('app\' + $webOutput)), $resources, [IO.Compression.CompressionLevel]::Optimal, $false)
$sdk = Join-Path $root '.tools\webview2'
Copy-Item "$sdk\lib\net462\Microsoft.Web.WebView2.Core.dll" $release -Force
Copy-Item "$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll" $release -Force
Copy-Item "$sdk\runtimes\win-x64\native\WebView2Loader.dll" $release -Force
Copy-Item "$root\assets\Inklet.ico" $release -Force
Copy-Item "$root\assets\Markdown.ico" $release -Force
Copy-Item "$root\assets\inklet.png" $release -Force
if (Test-Path (Join-Path $release 'licenses')) { Remove-Item (Join-Path $release 'licenses') -Recurse -Force }
Copy-Item "$root\licenses" (Join-Path $release 'licenses') -Recurse -Force
Copy-Item "$sdk\LICENSE.txt" (Join-Path $release 'licenses\WebView2-LICENSE.txt') -Force
Copy-Item "$root\QUICKSTART.md" $release -Force
Copy-Item "$root\LICENSE" $release -Force
if (Test-Path -LiteralPath (Join-Path $root 'assets\inklet.png')) {
    [void][IO.Directory]::CreateDirectory((Join-Path $release 'assets'))
    Copy-Item -LiteralPath (Join-Path $root 'assets\inklet.png') -Destination (Join-Path $release 'assets\inklet.png') -Force
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /win32icon:"$release\Inklet.ico" /reference:System.Web.Extensions.dll /reference:System.Web.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:"$release\Microsoft.Web.WebView2.Core.dll" /reference:"$release\Microsoft.Web.WebView2.WinForms.dll" /out:"$release\Inklet.exe" "$root\native\FileStore.cs" "$root\native\WorkspaceStore.cs" "$root\native\OpenHistory.cs" "$root\native\RuntimeDiagnostics.cs" "$root\native\ShellIntegration.cs" "$root\native\ExportService.cs" "$root\native\ResourcePack.cs" "$root\native\InkletApp.cs"
if ($LASTEXITCODE -ne 0) { throw 'Windows executable build failed.' }
Write-Output 'INKLET_NATIVE_BUILD_OK'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveName = $ReleaseName + '-Windows-x64.zip'
$archive = Join-Path (Join-Path $root 'release') $archiveName
if (Test-Path $archive) { Remove-Item $archive -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($release, $archive, [IO.Compression.CompressionLevel]::Optimal, $true)
Write-Output "INKLET_BUILD_OK $release\Inklet.exe"