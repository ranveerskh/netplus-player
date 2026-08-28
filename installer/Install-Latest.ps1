$ErrorActionPreference = 'Stop'
$repo = 'ranveerskh/netplus-player'
$api = "https://api.github.com/repos/$repo/releases/latest"
$headers = @{ 'User-Agent' = 'STB-PLAY-Updater' }

Write-Host 'STB PLAY - checking for the latest installer...'
$release = Invoke-RestMethod -Uri $api -Headers $headers
$asset = $release.assets | Where-Object { $_.name -match '^STB-PLAY-Setup-.*\.exe$|^Netplus-IPTV-Player-Setup-.*\.exe$' } | Select-Object -First 1
if (-not $asset) { throw 'No Windows installer was found in the latest GitHub release.' }

$target = Join-Path ([IO.Path]::GetTempPath()) $asset.name
Write-Host ("Downloading STB PLAY {0}..." -f $release.tag_name)
Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $target
if (-not (Test-Path $target)) { throw 'The latest installer could not be downloaded.' }
Start-Process -FilePath $target -Wait
Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
