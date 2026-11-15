$ErrorActionPreference = 'Stop'
$carmeleonProject = Split-Path -Parent $PSScriptRoot
if ($carmeleonProject -match '[^\x00-\x7F]') { throw 'Use an ASCII project path on Windows, for example C:\CARmeleon.' }

function Connect-CarmeleonDirectory([string]$LinkPath, [string]$SourcePath) {
    $sourceAbsolute = [IO.Path]::GetFullPath($SourcePath).TrimEnd('\')
    $linkAbsolute = [IO.Path]::GetFullPath($LinkPath).TrimEnd('\')
    if ($sourceAbsolute -eq $linkAbsolute) { return }
    if (-not (Test-Path -LiteralPath $sourceAbsolute -PathType Container)) {
        New-Item -ItemType Directory -Path $sourceAbsolute -Force | Out-Null
    }
    if (Test-Path -LiteralPath $linkAbsolute) {
        $existing = Get-Item -LiteralPath $linkAbsolute -Force
        if ($existing.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath([string]@($existing.Target)[0]).TrimEnd('\') -ne $sourceAbsolute) {
            throw "The local tool path already contains another directory: $linkAbsolute"
        }
    } else {
        New-Item -ItemType Junction -Path $linkAbsolute -Target $sourceAbsolute | Out-Null
    }
}

$carmeleonGradleSource = if ($env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME } else { Join-Path $env:USERPROFILE '.gradle' }
$carmeleonGradleAlias = Join-Path $carmeleonProject '.gradle-user-home'
Connect-CarmeleonDirectory $carmeleonGradleAlias $carmeleonGradleSource
$env:GRADLE_USER_HOME = $carmeleonGradleAlias

$carmeleonSdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))
$carmeleonSdkSource = $carmeleonSdkCandidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platforms') -PathType Container) } | Select-Object -First 1
if ($carmeleonSdkSource) {
    $carmeleonSdkAlias = Join-Path $carmeleonProject '.android-sdk'
    Connect-CarmeleonDirectory $carmeleonSdkAlias $carmeleonSdkSource
    $env:ANDROID_HOME = $carmeleonSdkAlias
    $env:ANDROID_SDK_ROOT = $carmeleonSdkAlias
    [IO.File]::WriteAllText((Join-Path $carmeleonProject 'local.properties'), ('sdk.dir=' + $carmeleonSdkAlias.Replace('\','/') + "`n"), [Text.Encoding]::ASCII)
}
