param([Parameter(ValueFromRemainingArguments=$true)][string[]]$GradleArguments = @(':shared:desktopTest', ':androidApp:assembleDebug'))
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts\Initialize-WindowsPaths.ps1')
$carmeleonJava = if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) { Join-Path $env:JAVA_HOME 'bin/java.exe' } elseif (Test-Path -LiteralPath 'C:\Program Files\Java\jdk-17\bin\java.exe') { 'C:\Program Files\Java\jdk-17\bin\java.exe' } else { (Get-Command java -ErrorAction Stop).Source }
& $carmeleonJava '-Dfile.encoding=UTF-8' '-Djava.net.preferIPv4Stack=true' '-jar' (Join-Path $PSScriptRoot 'gradle\wrapper\gradle-wrapper.jar') @GradleArguments '--console=plain'
exit $LASTEXITCODE
