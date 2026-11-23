# TERRA Android 실기기 재시도 — 2026-11-16

## 환경 및 격리

- Samsung SM-X820, Android 16 / API 36, ADB `172.20.6.114:46213`.
- 포트 38173에 기존 서버는 없었다. QA Node 서버는 저장소 cwd에서 실행했고 `/src/game.js` HTTP 응답 SHA-256이 로컬 파일과 일치했다 (`local-game-sha256.txt`, `served-game-sha256.txt`). 기존 프로세스와 세이브는 사용하거나 종료하지 않았다.
- 새 임시 QA 월드와 쿠키를 사용했다. 테스트 후 해당 임시 디렉터리를 삭제했다.
- ECLIPSE 가상 디스플레이 27: 1280×720, owner `dev.eclipse.vdisplay`, `removeMode 1`, `FLAG_OWN_CONTENT_ONLY`. 테스트 앱 Window Manager task 및 `TERRAVD CREATE`가 모두 display 27을 가리켰다. Display 0에는 입력·캡처를 하지 않았다.
- 테스트 종료 후 Display 0만 남았고, 앱·서버·ADB reverse mapping은 종료 상태다.

## 실행 및 결과

- Android WebView에서 `?terraDebug=1&terraFps=30` URL, 격리 fixture 쿠키, 1280×720 WebGL canvas를 확인했다. 최초 URL 전달에서 셸의 `&` 처리 오류를 발견해 올바르게 재실행했고, 최종 `PAGE_FINISHED`와 `WEBGL ... true`를 확인했다.
- 실제 display 27 입력 기록에는 이동 조이스틱 swipe와 카메라 회전 swipe가 있다 (`touches-display27.csv`). 조이스틱 이동 뒤 작물 밭이 보였다 (`move-01.png`). 회전 장면 (`rotate-01.png`)에는 plains 지형, 작물 타일, 광석, 설치 미리보기 윤곽이 보였다.
- 화면상 FPS는 초기 약 17.7, 회전 후 21.8로 30FPS 목표에 미달했다. 회전 캡처 프레임 시간 p50/p95는 약 49.9/50.0ms, draw calls 158, triangles 1932, 청크 25/25였다. 60FPS 측정은 하지 않았다.
- 회전 직후 HAL skin이 38.0°C에 도달해 즉시 테스트를 중단했다. Thermal status는 0이었고 종료 후 HAL skin은 35.0°C였다.
- 테스트 월드 API에는 5개 작물과 9개 기계 정의가 있었고, 기계와 가까운 상호작용 안내도 화면에 나타났다. 그러나 작업대·기계 모델 자체를 캡처에서 식별하지 못했다. 퀵바 아이콘도 이 장면에서는 비어 보였다. 인벤토리 열기, 제작·채굴·수확, 모든 퀵슬롯, 애니메이션은 검증하지 못했다.
- biome API는 seed `2221818671`의 plains/forest/beach/ocean/river 탐색 좌표를 반환했지만, 화면 텔레포트는 하지 않았다. 시각적으로 확인한 바이옴은 plains뿐이며 물 표현도 화면에서 확인하지 못했다.

## 종료 상태

- 자동 테스트나 소스 변경은 이번 재시도에서 수행하지 않았다. 직전 코드 변경 검증은 `npm test` 189/189, JS 구문 검사, `git diff --check` 통과였으며, 이 재시도에서는 마지막 `git diff --check`도 통과했다.
- HEAD `73323a40e132941d5cec8ee9ca88364e792ff114`; 미커밋 변경은 보존했다. 커밋, 원격 push, GitHub Actions 실행 없음.
- 핵심 캡처: `initial.png`, `move-01.png`, `rotate-01.png`. WebGL·터치·온도·종료 상태 로그가 이 디렉터리에 있다.
- 실기기 전체 E2E는 열 임계값 중단과 FPS 미달 때문에 미완료다. Display 0은 사용하지 않았다.
