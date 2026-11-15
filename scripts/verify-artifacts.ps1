$ErrorActionPreference = 'Stop'
$carmeleonRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $carmeleonRoot
. (Join-Path $PSScriptRoot 'Initialize-WindowsPaths.ps1')
$carmeleonJava = if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) { Join-Path $env:JAVA_HOME 'bin/java.exe' } else { 'C:\Program Files\Java\jdk-17\bin\java.exe' }
$carmeleonTools = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'lib/apksigner.jar') } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $carmeleonTools) { throw 'Android build tools are required for APK verification.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$carmeleonApks = foreach ($variant in @('debug','release')) {
    $folder = Join-Path $carmeleonRoot "android/app/build/outputs/apk/$variant"
    $metadata = Get-Content (Join-Path $folder 'output-metadata.json') -Raw | ConvertFrom-Json
    $apk = Get-Item (Join-Path $folder $metadata.elements[0].outputFile)
    $signature = @(& $carmeleonJava -jar (Join-Path $carmeleonTools.FullName 'lib/apksigner.jar') verify --print-certs $apk.FullName 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $($apk.Name)" }
    $badging = @(& (Join-Path $carmeleonTools.FullName 'aapt2.exe') dump badging $apk.FullName 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "APK metadata could not be read: $($apk.Name)" }
    $zip = [IO.Compression.ZipFile]::OpenRead($apk.FullName)
    try {
        $entryNames = @($zip.Entries | ForEach-Object { $_.FullName })
        $webEntryPoints = @($entryNames | Where-Object { $_ -match '^assets/(index\.html|assets/[^/]+\.(js|css))$' })
        if ($webEntryPoints.Count -gt 0 -or $entryNames -notcontains 'classes.dex' -or $entryNames -notcontains 'AndroidManifest.xml') { throw "Unexpected native APK content: $($apk.Name)" }
        $nativeMapFound = $false
        $pleosAdapterFound = $false
        foreach ($dex in @($zip.Entries | Where-Object { $_.FullName -match '^classes[0-9]*\.dex$' })) {
            $dexStream = $dex.Open()
            $dexMemory = New-Object IO.MemoryStream
            try {
                $dexStream.CopyTo($dexMemory)
                $dexStrings = [Text.Encoding]::ASCII.GetString($dexMemory.ToArray())
                $nativeMapFound = $nativeMapFound -or $dexStrings.Contains('map-proposal-marker')
                $pleosAdapterFound = $pleosAdapterFound -or $dexStrings.Contains('ai/pleos/carmeleon/pleos/PleosNavigationGateway')
            } finally { $dexStream.Dispose(); $dexMemory.Dispose() }
            if ($nativeMapFound -and $pleosAdapterFound) { break }
        }
        if (-not $nativeMapFound -or -not $pleosAdapterFound) { throw "Native map/typed Pleos implementation missing from $($apk.Name)" }
        [pscustomobject]@{
            variant = $variant
            path = $apk.FullName
            bytes = $apk.Length
            sha256 = (Get-FileHash $apk.FullName -Algorithm SHA256).Hash
            signatureVerified = $true
            certificate = @($signature | ForEach-Object { "$_" })
            metadata = @($badging | Where-Object { "$_" -match '^(package:|sdkVersion:|minSdkVersion:|targetSdkVersion:|native-code:)' } | ForEach-Object { "$_" })
            legacyWebEntryPoints = $webEntryPoints.Count
            nativeMapPresent = $nativeMapFound
            pleosAdapterPresent = $pleosAdapterFound
        }
    } finally { $zip.Dispose() }
}
$carmeleonExe = Get-Item 'desktopApp/build/compose/binaries/main/app/CARmeleon/CARmeleon.exe'
$carmeleonRuntime = Get-Item 'desktopApp/build/compose/binaries/main/app/CARmeleon/runtime/bin/server/jvm.dll'
$carmeleonNative = Get-Content 'verification/screenshots/native-verification.json' -Raw | ConvertFrom-Json
if ($carmeleonNative.status -ne 'passed') { throw 'Native preview verification did not pass.' }
$carmeleonDarkNative = Get-Content 'verification/screenshots/native-verification-dark-reduced.json' -Raw | ConvertFrom-Json
if ($carmeleonDarkNative.status -ne 'passed') { throw 'Dark reduced-motion native preview verification did not pass.' }
$carmeleonBackend = Get-Content 'verification/backend-check.json' -Raw | ConvertFrom-Json
if (-not $carmeleonBackend.passed) { throw 'Backend verification did not pass.' }
$carmeleonSuites = @(Get-ChildItem 'shared/build/test-results/desktopTest/TEST-*.xml' | ForEach-Object { ([xml](Get-Content $_.FullName -Raw)).testsuite })
$carmeleonTests = [pscustomobject]@{
    tests = [int](($carmeleonSuites | Measure-Object tests -Sum).Sum)
    failures = [int](($carmeleonSuites | Measure-Object failures -Sum).Sum)
    errors = [int](($carmeleonSuites | Measure-Object errors -Sum).Sum)
    skipped = [int](($carmeleonSuites | Measure-Object skipped -Sum).Sum)
}
if ($carmeleonTests.tests -lt 18 -or $carmeleonTests.failures -ne 0 -or $carmeleonTests.errors -ne 0 -or $carmeleonTests.skipped -ne 0) { throw 'Expected native/core/backend tests did not all pass.' }
$carmeleonOriginalHash = (Get-FileHash 'server/data/store.json' -Algorithm SHA256).Hash
if ($carmeleonOriginalHash -ne $carmeleonBackend.originalSha256) { throw 'Original backend store changed; inspect it without reverting user changes.' }
$carmeleonResult = [pscustomobject]@{
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
    passed = $true
    android = @($carmeleonApks)
    desktop = @{ path=$carmeleonExe.FullName; sha256=(Get-FileHash $carmeleonExe.FullName -Algorithm SHA256).Hash; bundledJvm=$carmeleonRuntime.FullName }
    tests = $carmeleonTests
    nativeChecks = @($carmeleonNative.checks).Count
    nativeCaptures = @($carmeleonNative.captures).Count
    darkReducedNativeChecks = @($carmeleonDarkNative.checks).Count
    darkReducedNativeCaptures = @($carmeleonDarkNative.captures).Count
    originalStoreSha256 = $carmeleonOriginalHash
    boundary = 'Windows preview and APK build only; physical Pleos services have not been exercised.'
}
$carmeleonResult | ConvertTo-Json -Depth 8 | Set-Content 'verification/artifacts-check.json' -Encoding UTF8
$carmeleonResult | Select-Object passed,verifiedAt,tests,nativeChecks,nativeCaptures
