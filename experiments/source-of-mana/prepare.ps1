$ErrorActionPreference = 'Stop'
$revision = '095803fe9bf496cafcfeebf6a62ae591593491bf'
$game = Join-Path $PSScriptRoot 'game'
$patch = Join-Path $PSScriptRoot 'patches/local-environment.patch'

if (-not (Test-Path -LiteralPath $game)) {
    & git clone --no-checkout --depth 1 https://github.com/sourceofmana/sourceofmana.git $game
    if ($LASTEXITCODE -ne 0) { throw 'Source of Mana clone failed.' }
    & git -C $game fetch --depth 1 origin $revision
    if ($LASTEXITCODE -ne 0) { throw 'Pinned revision fetch failed.' }
    & git -C $game checkout --detach $revision
    if ($LASTEXITCODE -ne 0) { throw 'Pinned revision checkout failed.' }
}

$head = & git -C $game rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head -ne $revision) {
    throw 'Existing checkout is not the pinned revision; no files were reset.'
}
New-Item -ItemType Directory -Force -Path (Join-Path $game 'sources/integration') | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'integration/*.gd') -Destination (Join-Path $game 'sources/integration')
& node (Join-Path $PSScriptRoot 'build-lobby.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Lobby content generation failed.' }
& git -C $game apply --reverse --check $patch 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host 'Local experiment patch is already applied.'
    exit 0
}
& git -C $game apply --check $patch
if ($LASTEXITCODE -ne 0) { throw 'Local patch conflicts; existing changes were preserved.' }
& git -C $game apply $patch
if ($LASTEXITCODE -ne 0) { throw 'Local patch failed.' }
Write-Host 'Source of Mana experimental checkout is ready.'
