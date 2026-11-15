param([string]$NodeDir = 'C:\Users\Desktop\agent-tools\ai-dispatch\tools\node')
$ErrorActionPreference = 'Stop'
$env:PATH = "$NodeDir;C:\Users\Desktop\.cargo\bin;C:\Users\Desktop\agent-tools\tools\PortableGit\cmd;C:\Users\Desktop\agent-tools\tools\PortableGit\usr\bin;$env:PATH"
$env:AGENTDECK_NODE_DIR = $NodeDir
# Import the free Visual Studio C++ build environment when installed.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($vs) {
    $devcmd = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
    & $env:ComSpec /s /c "`"`"$devcmd`" -arch=x64 -host_arch=x64 >nul && set`"" | ForEach-Object {
      if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
    }
  }
}
$repo = (Resolve-Path "$PSScriptRoot\..\..\..").Path
function Run-Npm { & npm.cmd @args; if ($LASTEXITCODE -ne 0) { throw "npm failed: $args" } }
Push-Location $repo
try {
  Run-Npm ci
  Run-Npm run build -- --force
  Set-Location apps/desktop
  if (Test-Path package-lock.json) { Run-Npm ci } else { Run-Npm install }
  Run-Npm run tauri build
  $output = 'C:\Users\Desktop\agent-tools\agentdeck-relay-deploy\installers'
  New-Item -ItemType Directory -Force $output | Out-Null
  $artifacts = Get-ChildItem src-tauri/target/release/bundle -Recurse -File | Where-Object { $_.Extension -in '.msi', '.exe' }
  if (!$artifacts) { throw 'Build returned no installer artifacts' }
  $hashes = foreach ($artifact in $artifacts) {
    Copy-Item -LiteralPath $artifact.FullName -Destination $output -Force
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output $artifact.Name)
    "$($hash.Hash)  $($artifact.Name)"
  }
  $hashes | Set-Content (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii
} finally { Pop-Location }

