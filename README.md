# CARmeleon

이동 경로를 함께 관리하며 여행 가이드와 업무 비서로 적응하는 차량용 AI 동행 앱입니다.

## APK

- [release APK](apk/CARmeleon_CARmeleon_release.apk) — `ai.pleos.carmeleon`, Android API 29 이상, Android Automotive 필요
- SHA-256: `09052e220720026d04142bb7e5f357e35aa69707f640f459ffedd3662a54d37e`
- release 변형이며 Android debug 인증서로 서명되어 있습니다. 공식 Pleos 에뮬레이터 설치 및 실행은 아직 확인하지 않았습니다.

## 실행 환경

Pleos 공식 설치 안내 기준: Pleos Connect Emulator 2.1.0, Android API 34. 프로젝트의 에뮬레이터 설정 스크립트는 2560 × 1440px, 240dpi를 지정합니다. 이는 설정 예시이며 실제 에뮬레이터 실행·화면 검증 결과는 아닙니다.

Pleos SDK: NaviHelper 3.0.5, FusedLocation 1.1.3, SpeechToText 3.3.1, TextToSpeech 3.3.1, Vehicle 2.3.2. 마이크·위치 권한과 해당 Pleos 서비스가 필요합니다.

## 설치

```powershell
adb devices -l
adb -s <에뮬레이터-serial> install -r .\apk\CARmeleon_CARmeleon_release.apk
adb -s <에뮬레이터-serial> shell am start -n ai.pleos.carmeleon/.MainActivity
```

## AI 서버

네이티브 앱은 에뮬레이터 호스트의 `http://10.0.2.2:3001` 에이전트 서버를 사용합니다. 앱의 AI·계정·자료 기능을 사용하려면 저장소 루트에서 Bun을 설치하고 서버를 실행하세요. API 키는 실행 환경에서 직접 설정하며 저장소에 포함하지 않습니다.

```powershell
bun install --frozen-lockfile
$env:CARMELEON_AGENT_HOST = '127.0.0.1'
$env:OPENAI_API_KEY = '<개인 OpenAI API 키>'
$env:CARMELEON_OPENAI_MODEL = '<사용 가능한 모델 ID>'
bun run agent:server
```

호스트의 `http://127.0.0.1:3001/api/v1/health`에서 서버 설정을 확인할 수 있습니다. 장소 검색과 도로 계산에는 서버의 Kakao REST 키가 추가로 필요합니다. 이 개발 서버는 로컬 저장을 사용합니다.

## 빌드

```powershell
.\Build-Carmeleon.ps1 :androidApp:assembleRelease
```

결과는 `android/app/build/outputs/apk/release/androidApp-release.apk`에 생성됩니다. 제출 영상은 PC 브라우저 Gemini Live 시연이며, APK의 Kotlin/Pleos UI 및 OpenAI 서버 구성과는 다릅니다.
