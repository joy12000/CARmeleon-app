# CARmeleon

**여행할 때는 가이드로, 일하러 갈 때는 비서로. 이동 경로를 함께 관리하는 차량용 AI 동행 앱입니다.**

CARmeleon은 목적지뿐 아니라 이동의 목적과 경로에 담긴 맥락을 함께 다룹니다. 여행에서는 지나가는 장소의 이야기를, 업무 이동에서는 다음 미팅에 필요한 정보를 적절한 순간에 전하는 경험을 지향합니다.

사용자와 AI가 같은 경로를 보며 일정을 준비하고, 경유지와 자료를 연결하고, 이동 중 생기는 상황에 맞춰 계획을 조정합니다. 내비게이션은 Pleos의 내비게이션 앱이 담당하며, CARmeleon은 분할 화면에서 경로 관리와 AI 대화를 담당하는 구성을 목표로 합니다.

**[CARmeleon release APK](apk/CARmeleon_CARmeleon_release.apk)**

## 주요 기능

- **상황에 맞는 대화** — 여행·업무 등 이동 목적과 경로의 맥락을 활용합니다.
- **함께 관리하는 경로** — 사용자가 직접 장소를 편집하거나, AI가 제안한 경로 변경을 확인하고 적용합니다.
- **경로에 연결된 자료와 기억** — 방문지에 필요한 자료와 메모를 연결해 대화에 활용합니다.
- **먼저 건네는 안내** — 위치와 이동 상황에 맞춘 선제 안내를 준비하고, 대화·주행 상태에 따라 발화 시점을 조절합니다.
- **음성 중심의 사용** — 짧은 음성 응답과 사용자 발화 시 응답 중단을 지원하도록 구성했습니다.

아래 실행 안내는 제출 APK를 기준으로 합니다. 실제 Pleos 서비스와의 연동 및 차량 환경에서의 동작은 추가 검증이 필요합니다.

## 제출 파일

| 항목 | 내용 |
| --- | --- |
| APK 위치 | [`apk/CARmeleon_CARmeleon_release.apk`](apk/CARmeleon_CARmeleon_release.apk) |
| 앱 ID | `ai.pleos.carmeleon` |
| 앱 버전 | `0.2.0` |
| 빌드 유형 | `release` — Android debug 인증서로 서명한 심사용 빌드 |
| 실행 대상 | Android Automotive / Pleos Connect, Android API 29 이상 |
| 소스 코드 | 이 저장소에 포함 |

<details>
<summary>APK SHA-256</summary>

```text
09052e220720026d04142bb7e5f357e35aa69707f640f459ffedd3662a54d37e
```

</details>

## 실행 방법

### 1. 실행 환경 준비

Pleos Connect 공식 에뮬레이터와 Android SDK Platform-Tools(`adb`), Bun이 필요합니다. 에이전트 서버는 에뮬레이터와 **같은 PC**에서 실행합니다.

이 저장소의 에뮬레이터 설정 스크립트에 명시된 환경은 다음과 같습니다.

| 항목 | 설정 |
| --- | --- |
| 에뮬레이터 | Pleos Connect v2.1.0 |
| Android | API 34 |
| 화면 규격 | 2560 × 1440px, 240dpi |

위 값은 프로젝트의 설정 기준입니다. 제출 APK를 생성한 PC에서는 공식 에뮬레이터를 실행하지 못했으므로, 해당 환경에서 APK 설치·실행과 화면 동작을 검증했다는 의미는 아닙니다.

### 2. 에이전트 서버 실행

저장소 루트에서 아래 명령을 실행합니다. 예시는 Windows PowerShell 기준이며, `<…>` 부분은 직접 발급한 키와 사용할 모델 ID로 바꿔 주세요.

```powershell
bun install --frozen-lockfile

$env:CARMELEON_AGENT_HOST = '127.0.0.1'
$env:OPENAI_API_KEY = '<OpenAI API 키>'
$env:CARMELEON_OPENAI_MODEL = '<계정에서 사용할 수 있는 모델 ID>'

# 장소 검색·도로 경로 계산을 사용할 때 추가 설정
$env:KAKAO_LOCAL_REST_API_KEY = '<Kakao Local REST API 키>'
$env:KAKAO_DIRECTIONS_REST_API_KEY = '<Kakao Mobility 길찾기 REST API 키>'

bun run agent:server
```

| 설정 | 용도 |
| --- | --- |
| `OPENAI_API_KEY`, `CARMELEON_OPENAI_MODEL` | 네이티브 앱의 AI 응답 생성 |
| `KAKAO_LOCAL_REST_API_KEY` | 장소 검색 |
| `KAKAO_DIRECTIONS_REST_API_KEY` | 도로 경로 계산 |

API 키는 저장소와 APK에 포함하지 않습니다. 해당 키를 설정하지 않으면 관련 외부 API 기능을 사용할 수 없습니다. 기본 개발 설정에서는 계정·경로·자료를 서버 PC의 `.carmeleon-private`에 저장합니다.

서버를 켠 상태에서 다른 PowerShell 창으로 상태를 확인합니다.

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/v1/health
```

`ok: true`는 서버 응답을, `modelConfigured: true`는 AI 설정값의 존재를 뜻합니다. 실제 모델 호출 성공 여부는 앱에서 대화해 확인해야 합니다.

### 3. APK 설치 및 실행

Pleos 에뮬레이터를 실행한 뒤, `adb devices -l`에 표시되는 기기 식별자를 `<에뮬레이터-serial>`에 넣습니다.

```powershell
adb devices -l
adb -s <에뮬레이터-serial> install -r .\apk\CARmeleon_CARmeleon_release.apk
adb -s <에뮬레이터-serial> shell am start -n ai.pleos.carmeleon/.MainActivity
```

앱이 요청하는 마이크·위치 권한을 허용해 주세요. 제출 APK의 서버 주소는 `http://10.0.2.2:3001`이며, 에뮬레이터에서 호스트 PC의 서버로 연결하기 위한 주소입니다.

### 4. 사용 흐름

1. 앱의 계정 화면에서 새 계정을 만들고 로그인합니다. 가입 비밀번호는 12자 이상입니다.
2. 새 경로를 만들고 방문할 장소를 추가합니다. 수동 편집은 정차 상태에서 진행합니다.
3. 필요하면 경로에 자료와 기억을 저장합니다.
4. 음성으로 요청하거나, 정차 중 설정의 **텍스트 입력**에서 대화를 시작합니다.
5. 경로 변경 제안이 나오면 내용을 확인한 뒤 적용하거나 취소합니다.

음성·위치·내비게이션 기능은 에뮬레이터의 Pleos 서비스 상태와 권한에 영향을 받습니다. 서버 연결만으로 모든 차량 기능이 활성화되는 것은 아닙니다.

## 개발 및 테스트 환경

| 구분 | 구성 |
| --- | --- |
| 제출 APK | Kotlin + Compose Multiplatform 기반 Android 앱 |
| 차량 연동 | Pleos Connect SDK |
| 네이티브 AI 서버 | Bun + TypeScript, OpenAI Agents SDK |
| PC 브라우저 시연 | React + Vite, Gemini Live |
| 확인 완료 | 제출용 웹 소스 빌드, 브라우저 폴백 관련 단위 테스트 55개 |
| 추가 검증 필요 | 공식 Pleos 에뮬레이터에서 APK 설치·실행, 음성·위치·내비게이션 연동 |

제출 영상은 **PC 브라우저 시연 환경**에서 촬영했습니다. 영상의 Gemini Live 음성 흐름과 제출 APK의 Kotlin UI·Pleos 음성·OpenAI 서버 구성은 서로 다르며, 영상은 APK의 Pleos 연동 검증 결과가 아닙니다.

앱에서 사용하는 Pleos SDK 버전은 다음과 같습니다.

| SDK | 버전 |
| --- | --- |
| NaviHelper | 3.0.5 |
| FusedLocation | 1.1.3 |
| SpeechToText | 3.3.1 |
| TextToSpeech | 3.3.1 |
| Vehicle | 2.3.2 |

## 소스에서 APK 빌드

JDK 17, Android SDK Platform 36과 빌드 도구를 준비합니다. Windows에서는 영문 경로에 저장소를 두고, `JAVA_HOME`과 `ANDROID_HOME`을 설치 위치에 맞게 설정해 주세요.

```powershell
.\Build-Carmeleon.ps1 :androidApp:assembleRelease
```

빌드 결과: `android/app/build/outputs/apk/release/androidApp-release.apk`

현재 release 설정은 Android debug 인증서로 서명합니다. 별도 서명 키와 비공개 API 설정은 이 저장소에 포함하지 않습니다.
