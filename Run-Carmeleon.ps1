param([switch]$Verify, [switch]$ExitAfterVerify, [switch]$Rebuild)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$carmeleonPreview = Join-Path $PSScriptRoot 'desktopApp/build/compose/binaries/main/app/CARmeleon/CARmeleon.exe'
if (-not $Verify -and -not $Rebuild -and (Test-Path -LiteralPath $carmeleonPreview)) {
    Start-Process -FilePath $carmeleonPreview -WorkingDirectory $PSScriptRoot
    exit 0
}
. (Join-Path $PSScriptRoot 'scripts\Initialize-WindowsPaths.ps1')
$carmeleonJava = if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) { Join-Path $env:JAVA_HOME 'bin/java.exe' } elseif (Test-Path -LiteralPath 'C:\Program Files\Java\jdk-17\bin\java.exe') { 'C:\Program Files\Java\jdk-17\bin\java.exe' } else { (Get-Command java -ErrorAction Stop).Source }
$carmeleonWrapper = Join-Path $PSScriptRoot 'gradle/wrapper/gradle-wrapper.jar'
if (-not (Test-Path -LiteralPath $carmeleonWrapper)) { throw 'Gradle wrapper is missing.' }
$carmeleonTask = if ($Verify) { ':desktopApp:run' } else { ':desktopApp:createDistributable' }
$carmeleonArgs = @('-Dfile.encoding=UTF-8','-jar',$carmeleonWrapper,$carmeleonTask,'--console=plain')
if ($Verify) { $carmeleonArgs += if ($ExitAfterVerify) { '--args=--verify --exit' } else { '--args=--verify' } }
& $carmeleonJava @carmeleonArgs
$carmeleonBuildExit = $LASTEXITCODE
if ($carmeleonBuildExit -eq 0 -and -not $Verify) {
    if (-not (Test-Path -LiteralPath $carmeleonPreview)) { throw 'Desktop preview executable was not generated.' }
    Start-Process -FilePath $carmeleonPreview -WorkingDirectory $PSScriptRoot
}
exit $carmeleonBuildExit
