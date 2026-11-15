param([string]$OutputDirectory = 'verification/pleos-handoff', [switch]$Build)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if ($Build) {
    & ./Build-Carmeleon.ps1 ':androidApp:assembleDebug'
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. An older APK will not be exported.' }
}
$apk = Join-Path (Get-Location) 'android/app/build/outputs/apk/debug/androidApp-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'Debug APK missing. Run the final build first.' }
$out = [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
New-Item -ItemType Directory -Path $out -Force | Out-Null
$targetApk = Join-Path $out 'CARmeleon-debug.apk'
Copy-Item -LiteralPath $apk -Destination $targetApk
$sourceFiles = @(& git ls-files --cached --others --exclude-standard -- '*.kt' '*.kts' 'server/agent/*.ts' 'server/agent*.ts' 'server/maps/*.ts' 'scripts/Export-PleosTestBundle.ps1' 'docs/*.md' 'docs/**/*.md' 'GEMINI.md' 'package.json' 'bun.lock') | Sort-Object -Unique
$sourceHashes = @($sourceFiles | ForEach-Object { if (Test-Path -LiteralPath $_ -PathType Leaf) { @{path=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash} } })
$manifest = [ordered]@{
    exportedAt=(Get-Date).ToUniversalTime().ToString('o')
    commit=(& git rev-parse HEAD)
    workingTreeDirty=(@(& git status --porcelain).Count -gt 0)
    apk=@{file='CARmeleon-debug.apk';sha256=(Get-FileHash -LiteralPath $targetApk -Algorithm SHA256).Hash;lastWrittenAt=(Get-Item -LiteralPath $apk).LastWriteTimeUtc.ToString('o')}
    buildExecutedByExport=[bool]$Build
    sdk=@{NaviHelper='3.0.5';FusedLocation='1.1.3';STT='3.3.1';TTS='3.3.1';Vehicle='2.3.2'}
    runtimeTests=@{officialEmulator='NOT_RUN';physicalVehicle='NOT_RUN';realModel='CREDENTIALS_REQUIRED'}
    sourceHashes=$sourceHashes
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'manifest.json') -Encoding utf8
foreach ($doc in (Get-ChildItem -LiteralPath 'docs' -Recurse -File -Filter '*.md')) {
    $relativeDoc = $doc.FullName.Substring((Get-Location).Path.Length + 1)
    $docTarget = Join-Path $out $relativeDoc
    New-Item -ItemType Directory -Path (Split-Path -Parent $docTarget) -Force | Out-Null
    Copy-Item -LiteralPath $doc.FullName -Destination $docTarget
}
Write-Output "Test bundle: $out"
Write-Output "APK SHA256: $($manifest.apk.sha256)"

# Only runnable agent sources; never copy user data, originals or .env.
$backend = Join-Path $out 'server/agent'
New-Item -ItemType Directory -Path $backend -Force | Out-Null
Get-ChildItem -LiteralPath 'server/agent' -File | Where-Object { $_.Extension -eq '.ts' -or $_.Name -eq 'tsconfig.json' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $backend $_.Name)
}
foreach ($file in @('server/agent-server.ts','server/agent.test.ts','server/agent-regressions.test.ts')) {
    Copy-Item -LiteralPath $file -Destination (Join-Path $out $file)
}
$maps = Join-Path $out 'server/maps'
New-Item -ItemType Directory -Path $maps -Force | Out-Null
Get-ChildItem -LiteralPath 'server/maps' -File -Filter '*.ts' | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $maps $_.Name)
}
foreach ($file in @('package.json','bun.lock','.env.agent.example','Start-Agent.ps1','GEMINI.md','README.md','DESIGN.md','PRODUCT.md')) {
    Copy-Item -LiteralPath $file -Destination (Join-Path $out ([IO.Path]::GetFileName($file)))
}
New-Item -ItemType Directory -Path (Join-Path $out 'verification') -Force | Out-Null
foreach ($file in @('verification/agent-artifacts.json','verification/mobile-ui-results.json','verification/mobile-map-results.json','verification/road-directions-results.json')) {
    if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $out $file) }
}
@'
# Pleos emulator test bundle — Gemini Antigravity

이것은 APK/서버/문서의 최소 시험 묶음입니다. 전체 개발과 재빌드는 Git 저장소를 사용합니다.
인수 상태/구조는 docs/PROJECT_HANDOVER.md, SDK 실행은 docs/PLEOS_EMULATOR_HANDOFF.md를 읽습니다.
문서의 Gradle/웹 명령은 전체 저장소용이며 이 최소 번들에는 Gradle/프론트 소스가 없습니다.

1. 이 폴더에서 bun install --frozen-lockfile 후 ./Start-Agent.ps1로 새 계정 API를 실행합니다.
2. 공식 에뮬레이터에 CARmeleon-debug.apk를 설치합니다. 기본 API는 호스트 PC의 http://10.0.2.2:3001 입니다.
3. 앱 설정에서 계정을 가입하고 로그인합니다. 키 없이 계정/경로/기억/텍스트 자료를 시험할 수 있습니다.
4. 설정의 SDK 독립 시험에서 STT/TTS/실제 내비 관찰을 확인합니다. 모델 키가 없어도 가능합니다.
5. 실제 AI/장소 검색은 .env.agent.example을 참고해 이 폴더의 .env에 서버 키/모델을 설정합니다. 키를 결과 파일에 넣지 않습니다.
6. docs/PLEOS_EMULATOR_HANDOFF.md와 docs/TEST_REQUIREMENTS.md에 따라 실제/미지원 결과를 기록합니다.
7. manifest.json의 APK SHA256과 설치 파일을 대조합니다. 로컬 시험 통과를 실제 SDK·차량 통과로 쓰지 않습니다.

기존 사용자 데이터, 실제 키, 원본 자료는 포함하지 않습니다. 운영 DB/버킷 개통은 별도입니다. 실제 도로 구간 공급자 없이는 선제 음성이 보류됩니다. Antigravity는 개발 도구이며 앱 모델은 OpenAI로 유지합니다. ZIP은 자동 생성하지 않습니다.
'@ | Set-Content -LiteralPath (Join-Path $out 'START_HERE.md') -Encoding utf8
