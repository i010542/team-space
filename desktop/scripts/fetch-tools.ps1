$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$downloads = Join-Path $project '.downloads'
$vendor = Join-Path $project 'vendor'
New-Item -ItemType Directory -Force -Path $downloads,$vendor | Out-Null
$tools = @(
  @{Name='git'; File='MinGit-2.56.0.4-64-bit.zip'; Url='https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/MinGit-2.56.0.4-64-bit.zip'; Hash='e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877'},
  @{Name='gh'; File='gh_2.103.3_windows_amd64.zip'; Url='https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_windows_amd64.zip'; Hash='98d0cfa794721665d7973dd728c78aff7bd836d58f10f6d7a03568eccb0a22e0'}
)
foreach ($tool in $tools) {
  $archive = Join-Path $downloads $tool.File
  if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $tool.Url -OutFile $archive }
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $tool.Hash) { throw "Checksum failed: $($tool.Name)" }
  Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $vendor $tool.Name) -Force
  Write-Output "$($tool.Name): verified and extracted"
}
