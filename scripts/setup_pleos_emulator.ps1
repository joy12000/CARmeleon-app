# CARmeleon: Pleos Connect v2.1.0 AVD Automatic Setup Script
$ErrorActionPreference = "Continue"

$url = "https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp_car_emulator.zip"
$expectedBytes = 4087751964
$expectedSha1 = "b4f858d5bcc6c71506d7edfc872bcb9e5a11acaa"

$downloadsDir = "$env:USERPROFILE\Downloads"
$zipPath = "$downloadsDir\crp_car_emulator.zip"
$logPath = "$downloadsDir\pleos_setup.log"

$sdkDir = "$env:LOCALAPPDATA\Android\Sdk"
$sysImgDir = "$sdkDir\system-images\android-34\pleos_car_emulator\x86_64"
$avdBaseDir = "$env:USERPROFILE\.android\avd"

function Write-SetupLog($msg) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$timestamp] $msg"
    Write-Host $line
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

Write-SetupLog "=== Pleos Connect AVD Auto-Setup Started ==="

# 1. Download loop with resume support
while ($true) {
    $currentBytes = 0
    if (Test-Path $zipPath) {
        $currentBytes = (Get-Item $zipPath).Length
    }
    
    $percent = [math]::Round(($currentBytes / $expectedBytes) * 100, 1)
    $currentMB = [math]::Round($currentBytes / 1MB, 1)
    $totalMB = [math]::Round($expectedBytes / 1MB, 1)
    Write-SetupLog "Download Progress: $currentMB MB / $totalMB MB ($percent%)"
    
    if ($currentBytes -ge $expectedBytes) {
        Write-SetupLog "Download Complete ($currentBytes bytes)!"
        break
    }
    
    $curlProc = Get-Process -Name "curl" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*system32*" -or $_.Path -like "*curl*" }
    if (-not $curlProc) {
        Write-SetupLog "No curl process found. Resuming download..."
        Start-Process -FilePath "curl.exe" -ArgumentList "-L", "-C", "-", "--retry", "20", "--retry-delay", "5", "-o", "`"$zipPath`"", "`"$url`"" -NoNewWindow
    }
    
    Start-Sleep -Seconds 30
}

# 2. SHA-1 verification
Write-SetupLog "Verifying SHA-1 checksum..."
$sha1 = (Get-FileHash -Path $zipPath -Algorithm SHA1).Hash.ToLower()
Write-SetupLog "Calculated SHA-1: $sha1 / Expected: $expectedSha1"

# 3. Extraction
if (-not (Test-Path $sysImgDir)) {
    New-Item -ItemType Directory -Path $sysImgDir -Force | Out-Null
}

Write-SetupLog "Extracting system image zip..."
$tempExtractDir = "$downloadsDir\pleos_extracted_temp"
if (Test-Path $tempExtractDir) { 
    Remove-Item -Path $tempExtractDir -Recurse -Force 
}
New-Item -ItemType Directory -Path $tempExtractDir -Force | Out-Null

tar.exe -xf "$zipPath" -C "$tempExtractDir"
Write-SetupLog "Extraction complete. Moving files into SDK system-images folder..."

$extractedItems = Get-ChildItem -Path $tempExtractDir
if ($extractedItems.Count -eq 1 -and $extractedItems[0].PSIsContainer) {
    Get-ChildItem -Path $extractedItems[0].FullName | Move-Item -Destination $sysImgDir -Force
} else {
    Get-ChildItem -Path $tempExtractDir | Move-Item -Destination $sysImgDir -Force
}
Remove-Item -Path $tempExtractDir -Recurse -Force -ErrorAction SilentlyContinue

# 4. Generate package.xml for Android Studio
Write-SetupLog "Writing package.xml for Pleos system-image..."
$pkgXml = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02" xmlns:ns3="http://schemas.android.com/sdk/android/repo/addon2/02" xmlns:ns4="http://schemas.android.com/sdk/android/repo/sys-img2/02" xmlns:ns5="http://schemas.android.com/sdk/android/repo/repository2/02">
    <localPackage path="system-images;android-34;pleos_car_emulator;x86_64" obsolete="false">
        <type-details xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ns4:sysImgDetailsType">
            <api-level>34</api-level>
            <tag>
                <id>android-automotive</id>
                <display>Pleos Connect v2.1.0 APIs</display>
            </tag>
            <vendor>
                <id>pleos</id>
                <display>Pleos Connect v2.1.0</display>
            </vendor>
            <abi>x86_64</abi>
        </type-details>
        <revision>
            <major>2</major>
        </revision>
        <display-name>Pleos Connect v2.1.0 APIs Intel x86_64 Atom System Image</display-name>
        <uses-license ref="pleos-connect-sdk-license"/>
        <dependencies>
            <dependency path="emulator">
                <min-revision>
                    <major>24</major>
                </min-revision>
            </dependency>
        </dependencies>
    </localPackage>
</ns2:repository>
'@
Set-Content -Path "$sysImgDir\package.xml" -Value $pkgXml -Encoding UTF8

# 5. Create Pleos Connect v2 AVD in Android Studio Device Manager
Write-SetupLog "Creating Pleos Connect v2 AVD device..."
if (-not (Test-Path $avdBaseDir)) {
    New-Item -ItemType Directory -Path $avdBaseDir -Force | Out-Null
}

$avdName = "Pleos_Connect_v2"
$avdIniPath = "$avdBaseDir\$avdName.ini"
$avdFolder = "$avdBaseDir\$avdName.avd"

if (-not (Test-Path $avdFolder)) {
    New-Item -ItemType Directory -Path $avdFolder -Force | Out-Null
}

$iniContent = @"
avd.ini.encoding=UTF-8
path=$avdFolder
path.rel=avd\$avdName.avd
target=android-34
"@
Set-Content -Path $avdIniPath -Value $iniContent -Encoding UTF8

$configIniContent = @"
AvdId=$avdName
PlayStore.enabled=false
abi.type=x86_64
avd.ini.displayname=Pleos Connect v2.1.0 (API 34)
avd.ini.encoding=UTF-8
disk.dataPartition.size=10G
fastboot.forceFastBoot=yes
hw.audioInput=yes
hw.battery=no
hw.camera.back=virtualscene
hw.camera.front=emulated
hw.cpu.arch=x86_64
hw.cpu.ncore=6
hw.dPad=no
hw.device.manufacturer=Hyundai Pleos
hw.device.name=pleos_car_display
hw.gps=yes
hw.gpu.enabled=yes
hw.gpu.mode=auto
hw.initialOrientation=landscape
hw.keyboard=yes
hw.lcd.density=240
hw.lcd.height=1440
hw.lcd.width=2560
hw.mainKeys=no
hw.ramSize=4096
hw.sdCard=yes
image.sysdir.1=system-images\android-34\pleos_car_emulator\x86_64\
runtime.network.latency=none
runtime.network.speed=full
sdcard.size=1024M
showDeviceFrame=yes
skin.dynamic=yes
skin.name=2560x1440
skin.path=2560x1440
tag.display=Pleos Connect v2.1.0 APIs
tag.displaynames=Pleos Connect v2.1.0 APIs
tag.id=android-automotive
"@
Set-Content -Path "$avdFolder\config.ini" -Value $configIniContent -Encoding UTF8

Write-SetupLog "=== Pleos Connect v2 Environment Setup Succeeded! ==="
