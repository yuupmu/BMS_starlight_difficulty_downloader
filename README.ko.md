# BMS 난이도표 다운로더

**한국어** · [日本語](README.ja.md) · [English](README.md)

6개 BMS 난이도표에서 표와 레벨을 고르고 BMS Library에서 곡 본체와 차분을 검색한 뒤, 서버 제한에 맞춰 순차적으로 다운로드를 요청하는 다국어 북마크 도구입니다.

## 빠른 설치

1. [설치 페이지 열기](https://yuupmu.github.io/BMS_starlight_difficulty_downloader/)
2. 북마크바가 보이지 않으면 `⌘/Ctrl + Shift + B`를 누릅니다.
3. 설치 페이지의 **★ BMS Table Downloader** 또는 **★ Standalone Downloader** 버튼을 북마크바로 드래그합니다.
4. [BMS Library Songs](https://horieyuuka.github.io/Songs)를 열고 방금 추가한 북마크를 클릭합니다.

GitHub README에서는 브라우저 보안 때문에 `javascript:` 북마크를 직접 실행할 수 없습니다. 설치 페이지의 파란 버튼을 북마크바로 드래그하는 방식이 가장 간단합니다. 로더가 차단되면 **Standalone Downloader**를 사용하세요.

## 주요 기능

- 첫 화면에서 Starlight(`sr`), Stardust(`ξ`), Satellite(`sl`), Stella(`st`), NEW GENERATION Normal(`▽`), Insane(`▼`) 선택.
- 선택한 표의 실제 데이터에 존재하는 레벨만 개수와 함께 표시.
- 오른쪽 위에서 한국어·日本語·English 전환.
- BMS Library의 Songs와 Sabuns 검색을 모두 사용.
- 완료된 검색 결과를 표·레벨별로 저장하고, 다음 실행에서 API 재검색 없이 즉시 복원. 중단된 검색은 저장된 지점부터 재개.
- **미다운로드** 필터에서 **현재 화면 전체 선택**을 눌러 높은 확률·검토 항목을 함께 자유롭게 선택.
- Chrome/Edge에서 다운로드 폴더를 직접 선택해 스트리밍 저장. 같은 이름의 기존 파일은 덮어쓰지 않음.
- 고정 배치 크기 외에 **서버 허용량까지 (자동)** 처리 지원.
- 대기열, 제한 초기화 시각, 설정, 다운로드 요청 이력을 브라우저에 영구 저장.
- 페이지를 닫거나 다운로드 제한에 걸려도 첫 미완료 파일부터 재개.
- 성공한 요청을 `song:<파일 ID>` 또는 `sabun:<파일 ID>`로 저장하여 중복 요청 방지.
- 다운로드 이력 창에서 **다시 받기**, 기록 삭제, CSV 내보내기 지원.
- 이전 `starlight-level-downloader:*:v2` 대기열과 설정 자동 이전.
- 실행 및 빌드 외부 의존성 없음.

## 사용자 설치

프로젝트의 [GitHub Pages 설치 페이지](https://yuupmu.github.io/BMS_starlight_difficulty_downloader/)에서 **★ BMS Table Downloader** 버튼을 브라우저 북마크바로 드래그합니다. 그다음 [BMS Library Songs](https://horieyuuka.github.io/Songs)를 열어 북마크를 실행합니다.

설치 페이지에는 두 가지 방식이 있습니다.

- **Hosted loader:** GitHub Pages의 최신 스크립트를 불러오는 짧은 북마크입니다.
- **Standalone:** 전체 코드를 북마크 안에 포함합니다. 페이지 보안 정책 때문에 외부 스크립트 로더가 차단될 때 사용할 수 있습니다.

## GitHub Pages 공개

`docs/` 폴더에 빌드된 설치 페이지가 이미 포함되어 있습니다.

1. GitHub 저장소를 만들고 이 프로젝트를 업로드합니다.
2. **Settings → Pages**를 엽니다.
3. **Deploy from a branch**를 선택합니다.
4. `main` 브랜치와 `/docs` 폴더를 선택합니다.
5. 저장한 뒤 생성된 Pages 주소를 엽니다.

설치 페이지가 현재 주소를 기준으로 스크립트 URL을 자동 생성하므로 사용자명과 저장소명을 코드에 적을 필요가 없습니다.

## 개발 및 빌드

Node.js 20 이상을 권장합니다.

```bash
npm test
npm run check
npm run build
```

Stardust·Satellite·Stella 공식 JSON 스냅샷을 최신화할 때는 `npm run sync:tables`를 실행합니다. 이 세 소스는 브라우저의 교차 출처 접근을 허용하지 않아 `docs/data/`에 출처 그대로 복제합니다.

`npm run build`는 외부 패키지가 필요 없는 `scripts/build.mjs`를 사용하여 다음 파일을 만듭니다.

```text
dist/starlight-difficulty-downloader.js
dist/SHA256SUMS.txt
docs/assets/starlight-difficulty-downloader.js
```

생성된 번들은 직접 수정하지 말고 `src/`의 모듈을 수정한 다음 다시 빌드하세요.

## 파일 구조

```text
starlight-difficulty-downloader/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── workflows/ci.yml             # 테스트·빌드 검증
├── docs/
│   ├── index.html                     # 다국어 설치 페이지 / GitHub Pages
│   ├── data/                          # 브라우저 호환 난이도표 스냅샷
│   └── assets/
│       └── starlight-difficulty-downloader.js
├── dist/
│   ├── starlight-difficulty-downloader.js
│   └── SHA256SUMS.txt
├── scripts/
│   ├── build.mjs                      # 무의존성 브라우저 번들러
│   ├── sync-tables.mjs                # 공식표 스냅샷 갱신
│   └── check.mjs                      # 문법 검사
├── src/
│   ├── api.js                         # 난이도표/BMS Library 통신
│   ├── app.js                         # 전체 동작 조정
│   ├── config.js                      # URL·상수·보조 링크
│   ├── history.js                     # 요청 이력·중복 키
│   ├── i18n.js                        # 한국어·일본어·영어 번역
│   ├── main.js                        # 번들 시작점
│   ├── matcher.js                     # 검색어·매칭 점수·선택 항목
│   ├── queue.js                       # 순차 다운로드·이어받기
│   ├── storage.js                     # localStorage·v2 이전
│   ├── styles.js                      # 도구 전용 CSS
│   ├── tables.js                      # 표 목록·레벨·데이터 정규화
│   ├── ui.js                          # 패널·이력 창·이벤트
│   └── utils.js                       # 공용 함수·CSV
├── tests/
├── LICENSE
└── package.json
```

## 이어받기와 중복 방지 방식

대기열과 요청 이력은 BMS Library 도메인의 `localStorage`에 저장됩니다.

서버가 다운로드 URL을 반환하면 도구가 브라우저 다운로드를 실행하고, 먼저 파일 종류와 ID를 이력에 기록한 다음 대기열에서 제거합니다. 두 저장 사이에 실행이 끊겨 대기열에 같은 항목이 남더라도 다음 실행에서 이력 키를 확인해 자동으로 제거합니다.

차분이 별도로 존재하는 채보는 곡 본체와 차분의 두 파일이 필요할 수 있습니다. 이때 진행 상황은 `1/2 요청 완료`처럼 표시됩니다.

검색 결과도 같은 `localStorage`에 표·레벨별로 저장됩니다. 같은 레벨의 **검색** 버튼을 다시 누르면 저장 결과를 불러오며, **새로 검색**을 누를 때만 캐시를 지우고 API 검색을 처음부터 실행합니다.

## 저장 폴더와 자동 다운로드

Chrome/Edge에서는 **저장 폴더 선택**으로 이번 실행에서 사용할 폴더를 고를 수 있습니다. 브라우저 보안상 도구는 전체 로컬 경로를 읽거나 임의의 경로를 문자열로 지정할 수 없으며, 페이지를 다시 연 뒤에는 권한 확인을 위해 폴더를 다시 선택해야 할 수 있습니다. 직접 저장이 지원되지 않는 브라우저는 브라우저의 기본 다운로드 폴더 또는 “다운로드 전에 각 파일의 저장 위치 확인” 설정을 사용합니다.

배치 크기의 **서버 허용량까지 (자동)**은 서버가 응답으로 알려 주는 현재 창의 잔여량을 따라 처리하고 0이 되면 대기열을 보존한 채 멈춥니다. 브라우저 기본 다운로드 방식에서는 여러 파일 자동 다운로드 허용 정책이 별도로 적용될 수 있으므로, 많은 파일에는 폴더 직접 저장 방식이 더 안정적입니다.

### 중요한 제한

**요청 완료**는 서버가 다운로드 URL을 발급했고 도구가 해당 파일을 브라우저에 전달했다는 뜻입니다. 웹페이지는 브라우저나 디스크에서 실제 저장이 끝났는지 확실히 확인할 수 없습니다. 브라우저 다운로드가 실패했다면 **다운로드 이력**에서 해당 파일의 **다시 받기**를 누르세요.

## 저장되는 정보

도구는 다음 설정과 동작 정보만 브라우저에 저장합니다.

- 선택한 언어, 난이도표, 표별 레벨;
- 한 번에 받을 개수;
- 남은 대기열;
- 서버가 반환한 제한 잔여량과 초기화 시각;
- 요청한 파일의 종류, ID, 제목, 레벨, 시각.
- 최근 표·레벨별 검색 결과(최대 8개 캐시).

별도의 프로젝트 서버는 운영하지 않으며, 이 이력을 다른 곳으로 업로드하지 않습니다.

## 데이터 출처와 안내

- Starlight: <https://djkuroakari.github.io/starlighttable.html>
- Stardust: <https://mqppppp.neocities.org/ChartView>
- Satellite: <https://stellabms.xyz/sl/table.html>
- Stella: <https://stellabms.xyz/st/table.html>
- NEW GENERATION Normal / Insane: <https://rattoto10.jounin.jp/table.html>
- BMS Library: <https://horieyuuka.github.io/Songs>

이 프로젝트는 독립적인 편의 도구이며 수록 난이도표 또는 BMS Library의 공식 프로젝트가 아닙니다. BMS 콘텐츠는 제작자와 배포처가 정한 조건 안에서 다운로드하고 사용하세요.

## 라이선스

MIT. [LICENSE](LICENSE)를 확인하세요.
