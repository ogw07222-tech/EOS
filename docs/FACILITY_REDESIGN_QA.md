# TERRA 시설·기계 리디자인 QA 계획

작성 상태: 시설 모델 자동 검증 완료. Android 실기기 검증은 장치 미연결로 보류.

## 작업 트리 인수인계

- 기준 브랜치: `prototype/unified-water-gate`; 기준 커밋 `26bf71a`.
- 인수 시 이미 미커밋인 오픈월드 작업: `README.md`, `docs/GAME_DESIGN_AND_ROADMAP.md`, `index.html`, `server.mjs`, `src/chunk-world.mjs`, `src/game.js`. 이 QA 작업은 이 파일들을 수정하지 않는다.
- 이전 증거 폴더 `android-vd-host/evidence/android16-2026-11-15/`, `eos-prompt-2026-11-15/`, `terra-open-world-20261115/`를 보존한다.
- 인수 시점에는 실행 중인 `node server.mjs`가 없었다. 다음 Android QA에서는 PID, 실행 cwd, 실제 포트와 `/api/world` 응답을 함께 확인한다.
- Download에는 `TERRA_T0_Workstations_3D_v2.html`, `TERRA_T0_Workstations_3D.html`, `TERRA_AutoDrill_Package_v1/TERRA_AutoDrill_v1.glb`, viewer HTML 및 preview PNG가 있다. 모델은 GLB loader 의존성을 새로 추가하지 않고, HTML은 디자인 참고로만 검토한다. GLB의 제작자/라이선스 메타데이터는 확인되지 않았으므로 그대로 프로젝트에 복사하거나 재배포하지 않는다.

## 현재 월드 객체와 보존 계약

| 타입/객체 | 존재 여부와 실제 ID | 서버 계약 |
|---|---|---|
| 기본 T1 제작대 | `t1_bench`, 신규 월드 시작 배치 | 제작대 상호작용 범주 |
| 목재 작업대 | `workbench` | T1 제작대에서 제작, 배치 후 저장 |
| 구형 농업 제작대 별칭 | `farming_bench` | 저장된 기존 타입·레시피 호환 |
| 도구 제작대 | `tool_bench` | 기존 레시피와 아이템 ID 유지 |
| 농업 제작대 | `agriculture_bench` | 기존 레시피와 아이템 ID 유지 |
| 블록 제작대 | `block_bench` | 기존 레시피와 아이템 ID 유지 |
| 초급 조합대 | `basic_assembler` | 기존 레시피·산업 설비 제작 게이트 유지 |
| 드릴 | `drill` | 인접 광맥에서 생산, `productionMs`와 생성 아이템 저장 |
| 컨베이어 | `conveyor` | 회전 및 한 칸 상승 연결, 드롭 위치·진행도 저장 |
| 제련기 | `smelter` | 기존 배치/표현 타입. 새 레시피나 생산 로직을 추가하지 않는다 |
| 허브/귀환 포털 | 월드 전환용 비기계 시각 오브젝트 | `personalPortal`, 허브 레이아웃과 서버 보호 판정 유지 |

우주선·우주정거장 모델은 현재 렌더러 타입/서버 배치 타입으로 확인되지 않아 구현 대상에서 제외한다. 포털은 기계 설치물로 취급하지 않는다.

## 자동 검증 행렬

| 영역 | 자동 검증 | 실기기 검증 |
|---|---|---|
| 모델 계약 | 각 실제 타입 factory 생성, 서로 다른 파츠/실루엣, 1×1m X/Z 경계, 바닥 기준, 회전 후 AABB, 이동 파츠 metadata, dispose 후 공유 리소스 생존 | 제작대 5종과 산업 설비 3종의 근·원거리 캡처 |
| 시설 시스템 | 타입 ID/레시피 변경 없음, 회전 0/1/2/3 저장, 기존 충돌·설치 면적, 재시작 후 불변 | 0/90/180/270° 설치 및 사용 반경 확인 |
| 대량 배치 | 모델 1/10/100개 생성 시 Mesh/geometry/material 증가율 기록. 가능한 경우 공유/병합 구조에서 개별 인스턴스 대비 증가가 억제되는지 검사 | 동일 시드·청크·카메라에서 FPS, 프레임 시간, draw calls, triangles 비교 |
| 산업 동작 | 드릴 회전자·컨베이어 벨트 메타데이터, 실제 conveyor drop 상태와 모션 연결, inactive 상태 정지 | 드릴 idle/생산, 벨트 item 흐름/상승/곡선, 제련기 상태 변화 캡처 |
| 리소스 수명 | 반복 생성/제거/청크 재생성 뒤 shared material/geometry를 폐기하지 않는지 검사 | WebGL geometry·texture 수와 context count의 장시간 추이 확인 |
| 지형 A | atlas 타일 UV, 내부 면 제거, 동굴 면, 청크 halo 경계, 반복 텍스처 유지 | 지표/동굴/청크 경계 캡처와 실제 이동·채굴 |
| 자연 B | oak/birch/rubber dimensions·시각 root·작물 성장 단계별 생성 | 수종별 실루엣 및 밀·당근·감자 성장/채집 확인 |
| 바이옴/물 | 최근 `/api/dev/biomes` 좌표에서 `plains`, `forest`, `beach`, `river`, `ocean` API/월드 생성 일치 확인 | 같은 최신 시드에서 5개 위치 텔레포트/화면 캡처. 실제 미구현은 BLOCKED로 남긴다 |
| UI D | 8칸 퀵바, 터치 영역, HUD/제작창 회귀, 접근성 이름 | 모바일 퀵바 선택, 제작 상호작용, 패널 겹침 및 터치 확인 |
| devtools 분리 | 개발 모드에서만 dev API/패널 제공. 프로덕션은 개발 API 숨김 | 최신 게임 빌드와 서버 응답 식별, 옛 10×10 월드/옛 서버 포트 혼동 없음 확인 |
| 저장 계약 | 테스트 전용 SAVE_DIR의 월드 생성/배치/재시작/불러오기 후 저장 타입과 아이템 불변 | 사용자 저장 경로는 읽거나 초기화하지 않는다 |

## Android 안전·수집 절차

1. 실제 연결된 Samsung SM-X820 Android 16 및 ECLIPSE 소유 가상 디스플레이 16을 식별한다. Display 0에는 입력하거나 캡처하지 않는다.
2. 디스플레이 소유자·크기·격리·미러링 상태와 `dev.terra.vdtest/.BrowserActivity`의 표시 ID를 재확인한다.
3. 서버 PID/cwd/포트를 프로세스와 실제 HTTP 응답으로 식별하고, QA 전용 저장 디렉터리에서 실행한다. `/api/world`의 `worldGenVersion`, `worldSeed`, `worldKind`와 응답받은 클라이언트 JS 모듈이 동일 테스트 빌드인지 기록한다.
4. 동일한 seed, 카메라, chunk radius, 화면 크기에서 기존 증거와 새 디자인을 비교한다. 30FPS와 60FPS 목표를 별도로 측정하고 frame-time p50/p95 및 `renderer.info` draw calls/triangles/geometries/textures를 가능한 범위에서 저장한다. 측정 불가능한 GPU VRAM/온도 수치를 추정하지 않는다.
5. 각 스냅샷은 ECLIPSE 소유 화면 캡처 경로만 이용한다. 브라우저 DOM/WebGL context 수는 진단 기록으로 수집하되, 실제 그래픽 품질 판정은 렌더된 캡처로 한다.
6. 신뢰 가능한 thermal 센서·측정 시점·상태를 같이 기록한다. 표면 또는 AP 온도가 빠르게 상승하거나 스로틀링/시스템 경고가 있으면 대량 배치/장시간 회전 시험을 즉시 중단하고 냉각 전 재개하지 않는다.
7. 종료 시 TERRA BrowserActivity를 force-stop하고 가상 디스플레이를 정상 종료한다. 남은 reverse/QA 서버 세션도 해당 항목만 정리한다.

## 현재 알려진 검증 한계

- 2026-11-16에 `node --check tests/facility-redesign-qa.test.mjs` 및 다음 집중 회귀 묶음을 실행했다: `node --test tests/facility-redesign-qa.test.mjs tests/workstation-visuals.test.mjs tests/industrial-visuals.test.mjs tests/workstations.test.mjs tests/ux-regression.test.mjs`. 결과 **24/24 통과**. 여기에는 모델 경계·실루엣·공유 버퍼·dispose, 산업 이동 파츠 metadata, 게임 연결/ID·회전·저장 계약, 다섯 바이옴 ID, UX와 제작대 레시피/배치/재시작 회귀가 포함된다.
- 첫 집중 실행에서 레거시 배치 테스트 fixture가 새 오픈월드 생성 위치와 맞지 않아 실패했으나, fixture를 마이그레이션 기준에 맞춘 뒤 동일 묶음을 재실행해 통과했다. 테스트 기대값을 낮추거나 검사를 제거하지 않았다.
- 위 결과는 headless 자동 검사다. Android 실제 화면, FPS/frame-time, GPU 온도, draw calls/triangles, 메모리 추이는 아직 미측정이다. 2026-11-16 ADB 조사에서 연결 장치가 없고 이전 무선 연결도 거부되어 Android 확인은 **BLOCKED**다. 상세 안전 절차와 증거 수집 규칙은 [FACILITY_ANDROID_PERFORMANCE_QA.md](FACILITY_ANDROID_PERFORMANCE_QA.md)에 기록했다.
- 100개 기계의 실기기 비용, 장시간 청크 이동, 실제 드릴/벨트 애니메이션 및 회전·상호작용 조합은 기기 검증 전까지 미검증이다. 자동 테스트의 반복 모델 생성은 GPU 성능 측정으로 간주하지 않는다.
- 전체 테스트 묶음에서 보고된 오픈월드 관련 실패는 시설 리디자인 집중 묶음의 24/24 통과 결과와 별개로 추적한다. 그 결과는 이 문서에서 시설 시각 테스트 실패나 통과로 재분류하지 않는다.
