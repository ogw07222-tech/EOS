# TERRA Android E2E — 2026-11-16

## 실행 환경 및 격리

- 기기: Samsung SM-X820, Android 16 / API 36, ADB `172.20.6.114:46213`.
- 서버 포트 38173은 실행 전 Termux `ss` 부재로 바로 확인할 수 없었고 Android `ss`는 netlink 권한 오류였다. Android `/proc/net/tcp*` 조회와 프로세스 목록에는 기존 리스너가 없었으며 `127.0.0.1:38173`은 connection refused였다. 기존 PID를 종료하지 않았다.
- QA 서버는 저장소 `/data/data/com.termux/files/home/EOS`의 `node server.mjs`로 실행했다. E2E 중 확인된 PID 31126, 소유자 `u0_a547`, cwd가 저장소 경로였다. 저장된 소스 SHA-256은 `source-sha256.txt`에 있다. ADB reverse를 쓰면 같은 네트워크 네임스페이스에서 포트 충돌이 발생해 reverse 없이 기기 로컬호스트로 접속했다.
- 월드 fixture·cookie·secret은 별도 임시 QA 루트에서 생성했다. 저장소의 실제 세이브를 사용하지 않았으며 임시 QA 루트는 정리했다.
- ECLIPSE 소유 가상 디스플레이는 매 실행 시 Android가 할당한 ID 16–26 중 하나였으며, 매번 1280×720 가상 화면, `dev.eclipse.vdisplay` 소유자, `removeMode 1`, own-content-only 및 미러링 비활성 설정을 확인했다. BrowserActivity는 해당 디스플레이에만 실행했다. Display 0에는 입력이나 캡처를 하지 않았다.
- 종료 후 ECLIPSE 디스플레이와 TERRA 테스트 앱은 종료됐고, ADB reverse 목록과 Node 서버 프로세스는 비어 있었다. Display 0만 남은 것을 확인했다.

## 실제 확인한 항목

- Android WebView에서 최신 로컬 서버 화면 로드 및 WebGL 컨텍스트 생성 성공 (`webgl-full.csv`).
- 1280×720 화면에서 복셀 지형, 작물·경작지, 광석, 인벤토리 아이콘을 캡처했다. 인벤토리 도구 선택 입력과 퀵바 관련 화면을 확인했다.
- 30FPS 제한에서 반복 측정했다. 최종 캡처 `30fps-radius2-no-shadows-settled.png`: 렌더 FPS 21.7, p50/p95 프레임 시간 49.8/50.1ms, draw calls 150, triangles 1860, texture 1, 청크 25/25, water meshes 5, 청크 생성 지표 약 143.9/141.3ms. 30FPS 목표 미달이다. 화면 부하를 더 올리는 60FPS 비교는 실행하지 않았다.
- 기기 상태는 workload 중 thermal status 0, skin이 최종 측정에서 33.3°C였다. 별도의 이전 시도에서 캐시 skin 값이 38°C를 넘었을 때 즉시 부하를 중단했다.
- 마지막 장면은 plains만 확인했다. 테스트 fixture의 기계들이 서버 상태에 존재하고 인근 상호작용 문구가 나타났지만, 최종 시점 캡처에서 작업대/기계 모델의 형태를 명확히 식별할 수 없었다. 해안·숲·강·바다, 물 표현, 채굴·제작·이동 회귀 및 애니메이션은 충분히 시각 검증하지 못했다. 이 항목들은 PASS가 아니다.

## 성능 대응과 검증

- 터치 하드웨어에서 기본 청크 반경을 2로 낮추고 그림자 맵을 끄는 저부하 경로를 추가했다. 데스크톱 기본값과 명시적인 품질 설정은 유지한다.
- `npm test`: 189/189 통과 (0 실패).
- `node --check src/game.js`, `node --check tests/ux-regression.test.mjs`: 통과.
- `git diff --check`: 통과.
- 성능 조정 후 30FPS 실측은 여전히 목표에 미달하여 E2E 전체 완료 판정은 실패/미완료다. 기능 회귀의 Android 실기기 재검증도 미완료다.

## 종료 상태

- 로컬 HEAD: `73323a40e132941d5cec8ee9ca88364e792ff114` (변경 커밋 없음).
- 워킹 트리의 기존 미커밋 변경 및 세이브 보존. GitHub Actions 실행 및 원격 push 없음.
- 주요 화면 증거: `baseline.png`, `inventory.png`, `quickslot-selected.png`, `30fps-radius2-no-shadows-settled.png`, `models-angle-30fps.png`.
