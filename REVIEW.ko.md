# BMS Difficulty Downloader 구조·호환성 검토

검토일: 2026-08-04

## 결론

현재 도구는 난이도표에서 곡을 고르는 부분과 실제 파일을 받는 부분이 분리되어 있지 않아, **검색과 개별 다운로드 모두 BMS Library의 비공개 프런트엔드 API**에 의존한다. 약 20건 뒤 멈추는 주원인은 브라우저의 동시 다운로드 수가 아니라 BMS Library 서버의 시간 구간/일일 다운로드 허용량이다. 기존 코드가 이미 한 번에 하나씩 5초 간격으로 요청하고, 서버가 `remainingInWindow`, `remainingToday`, `windowResetsAt`을 돌려주며, 공식 프런트엔드도 429와 다운로드 쿼터를 별도로 처리한다.

다만 브라우저의 자동 다중 다운로드 권한은 별개의 2차 제한이다. 기본 다운로드 모드에서는 서버가 URL을 발급한 뒤 브라우저가 파일을 실제로 저장했는지 페이지가 확인할 수 없다. 선택 폴더 모드에서는 `fetch`와 파일 쓰기가 끝날 때까지 확인할 수 있지만, 이 방식은 대상 호스트가 CORS를 허용해야 한다.

따라서 권장 방향은 다음 두 가지를 병행하는 것이다.

1. 수십·수백 곡의 전체 묶음은 BMS Library가 직접 권장하는 공식 패키지와 torrent를 사용한다.
2. 개별 곡/차분은 공통 queue core와 provider adapter를 사용하되, 공개 API 또는 자동화 허가가 확인된 공급원만 자동화한다.

## 현재 의존 구조

- 실행 페이지: `https://horieyuuka.github.io/Songs`
- 곡 검색: `https://horie.synology.me:8443/api/v1/folders/Songs/files`
- 차분 검색: `https://horie.synology.me:8443/api/v1/sabuns`
- 곡 다운로드 권한: `POST /api/v1/files/{id}/download-grants`
- 차분 다운로드 권한: `POST /api/v1/sabuns/{id}/download-grants`
- 인증 방식: 명시적 로그인 화면은 없지만 `credentials: include`로 origin/session 쿠키를 전달

난이도표 데이터는 여러 출처를 읽지만, 그것은 곡을 식별하는 메타데이터일 뿐이다. 실제 다운로드 공급원은 BMS Library 한 곳이다. 설정에 있는 Google Drive, Dropbox, Internet Archive 등의 fallback은 사용자가 직접 열 수 있는 링크이며, 같은 곡을 자동으로 찾아 바꾸는 미러 adapter가 아니다.

## 약 20건 후 실패하는 원인

### 1순위: 서버 쿼터/rate limit

- 기존 queue는 병렬 요청이 아니라 직렬 요청이며 기본 간격은 5초다.
- grant 응답에 시간 구간 잔여량, 일일 잔여량, 초기화 시간이 포함된다.
- BMS Library 공식 프런트엔드는 429를 다운로드 쿼터 초과로 표시하고 Pixeldrain 사용을 안내한다.
- 따라서 “20”은 브라우저 동시성 한도와 모양이 맞지 않고 서버 정책과 일치한다.

공개 문서에는 정확히 20건인지, IP·쿠키·origin 중 무엇을 키로 삼는지, 시간 창이 몇 분인지가 명시되어 있지 않다. 코드는 서버가 돌려준 수치와 `Retry-After`만 신뢰해야 하며, IP/쿠키 회전으로 우회해서는 안 된다.

### 2순위: 브라우저 자동 다운로드 권한

Chrome 계열은 한 사이트가 여러 파일을 자동으로 내려받을 때 사이트 권한을 적용한다. 이 제한은 grant API의 429와 별개다. 허용하지 않으면 서버 URL 발급은 성공해도 브라우저 저장이 차단될 수 있다.

### 3순위: CORS와 보안 검사

- 링크/iframe으로 다른 origin을 탐색하는 다운로드에는 일반적인 CORS 읽기 권한이 필요하지 않다.
- 선택 폴더에 스트리밍하려고 `fetch`하면 CORS가 필요하다.
- Google Drive/Dropbox 공유 페이지, CAPTCHA, Cloudflare류 도전 페이지, HTML 오류 페이지는 파일처럼 저장하면 안 된다.
- Safe Browsing 또는 archive 검사도 일부 파일을 차단할 수 있다.

## 대체 공급원 비교

| 공급원 | 역할 | 공개 API / robots | 로그인·CORS·보호 | 직접 URL 안정성 | 대량 사용 판단 |
|---|---|---|---|---|---|
| BMS Library | 현재 곡/차분 카탈로그와 파일 서버 | 프런트엔드용 API는 있으나 공개 API 계약은 찾지 못함. robots는 자동화 허가를 대신하지 않음 | 로그인 UI는 없으나 쿠키 포함. origin/CORS 정책 존재. Cloudflare 사용은 확인하지 못함 | grant URL은 서버가 발급하는 임시 전달 URL로 취급해야 함 | 개별 grant 대량 호출은 부적합. 공식 홈페이지가 큰 묶음은 torrent 사용을 권장 |
| BMS Library package / torrent | 연도별 대형 묶음 | 홈페이지에 공식 배포 링크 제공 | torrent client 필요. 일부 Pixeldrain/직접 링크 제공 | torrent는 체크섬·재개에 강함 | **가장 적합**. 사이트 운영자가 직접 권장 |
| BMS SEARCH venue | 이벤트/작자 다운로드 링크 메타데이터 | 문서화된 범용 다운로드 API·대량 이용약관은 찾지 못함 | 실제 호스트마다 로그인/CORS/보호가 다름 | 링크가 Drive·Dropbox·개인 서버 등으로 분산 | event package 또는 사용자가 고른 링크를 여는 용도. 무단 대량 HTML 수집은 비권장 |
| manbow / nothing.sh | 이벤트 등록 페이지와 URLList | 문서화된 다운로드 API·자동화 약관은 찾지 못함 | 외부 호스트로 이동 | 오래된 이벤트 링크는 소멸 가능, HTML 구조도 계약이 아님 | 이벤트 패키지 우선. 페이지 scraper를 핵심 backend로 삼지 않음 |
| BMSworld | 보존 아카이브 | 공개 검색/다운로드 API는 찾지 못함. 삭제 요청 정책 공개 | 일부 다운로드에 CAPTCHA가 있어 자동화 방지 의도가 명확. 보호 업체는 확인하지 못함 | 페이지 기반, 원본이 아닌 복구본일 수도 있음 | 북마클릿 대량 자동화 대상에서 제외. 사용자가 직접 확인하고 받는 fallback |
| Internet Archive | 공개 보존 미러 | Metadata/Search API와 robots 공개 | 공개 item 읽기는 대체로 로그인 불필요. CORS는 endpoint별 확인 필요 | `/download/{identifier}/{filename}` 형식은 공식적으로 안정 URL | 권리와 item 식별을 확인한 경우 adapter 가능. 설명적 User-Agent, 지연, 429/Retry-After, 체크섬 사용 필수 |
| Pixeldrain | 패키지/외부 파일 호스트 | 공식 API 제공 | 공개 다운로드는 로그인 불필요. direct hotlinking과 과도한 사용에 CAPTCHA/403/429 가능 | file ID가 유지되는 동안 API URL은 예측 가능. 삭제/제한 가능 | 알려진 공식 package ID에 적합. 범용 BMS 검색 공급원은 아님 |
| Google Drive | 작자/이벤트 외부 호스트 | Drive API 공개, API 사용은 OAuth/쿼터 적용 | 공개 공유 링크는 로그인 없이 가능할 수 있으나 확인·권한·악성파일 경고가 개입. 임시 링크는 CORS용이 아님 | 소유자가 권한 변경/삭제 가능. `uc` 형태를 영구 direct URL로 가정하면 안 됨 | user navigation adapter만 안전. API 기반 대량 수집은 OAuth와 403/429 backoff 필요 |
| Dropbox | 작자/이벤트 외부 호스트 | API와 `dl=1` 다운로드 동작 공개 | 공개 링크는 로그인 없이 가능. redirect와 공유 링크 제한 존재 | 소유자가 링크를 만료/비활성화할 수 있음 | 알려진 공개 링크의 navigation adapter 가능. 429/`Retry-After` 처리, 공유 대역폭 존중 |
| 작자 공식 URL / 난이도표 `url`, `url_diff` | 가장 원출처에 가까운 경로 | 공통 API 없음 | 호스트별로 모두 다름 | 의미상 가장 정확하나 오래된 링크가 많음 | 우선 표시하되 자동 다운로드는 host adapter가 안전하다고 판정한 경우만 |

약관이 따로 공개되지 않은 이벤트 사이트는 “허용”으로 해석하지 않았다. `robots.txt`는 크롤링 지침이지 저작권 라이선스나 대량 다운로드 허가가 아니다. BMS 콘텐츠의 이용 권리는 각 작자와 배포자의 조건이 우선한다.

## 권장 adapter 경계

사이트별 코드를 완전히 따로 만들 필요는 없다. 다만 **메타데이터 공급원**과 **파일 호스트**의 차이는 adapter로 흡수해야 한다.

```js
// catalog/provider adapter
{
  id,
  capabilities,
  search(sourceType, query),
  prepare(queueItem, requestOptions)
}

// prepare() 결과의 장기 권장 형태
{
  mode: 'fetch' | 'navigate' | 'torrent' | 'manual',
  downloadUrl,
  fileName,
  expiresAt,
  rateLimit,
  expectedHash
}
```

- `fetch`: CORS가 확인되고 완료 여부를 추적할 수 있는 API/직접 파일
- `navigate`: 브라우저가 처리해야 하는 외부 공유 링크; 실제 완료 확인 불가
- `torrent`: 대형 공식 패키지; 별도 클라이언트로 전달
- `manual`: CAPTCHA, 로그인, 이용조건 확인 등이 필요한 페이지

queue item은 최소한 `providerId`, `type`, `id`, `title`을 가진다. 중복 키는 `providerId:type:id`로 만든다. 같은 ID라도 공급원이 다르면 충돌하지 않는다.

## 이번 패치

- 사용자가 선택한 압축 해제 BMS 루트 폴더를 재귀 검사
- `.bms`, `.bme`, `.bml`, `.pms`만 로컬에서 SHA-256/MD5 계산
- 난이도표 해시와 일치하는 설치 곡 표시 및 미설치/설치 필터 추가
- 동일 디렉터리의 경로·크기·수정시각이 같은 파일은 IndexedDB 해시 재사용
- 설치된 항목을 일괄 선택과 기존 다운로드 대기열에서 제외
- BMS Library 코드를 `providers.js` adapter로 분리
- provider registry 추가
- queue와 history 중복 키를 provider 범위로 변경
- 네트워크/408/425/5xx에 최대 3회 exponential backoff와 jitter 적용
- `Retry-After`를 존중하고 429에서는 일반 retry를 하지 않음
- 진행 중 중단 버튼 추가; 현재 요청이 끝나면 멈추고 나머지 queue를 보존
- 숨은 iframe을 60초 뒤 정리
- 오류/쿼터 메시지가 마지막 batch 완료 메시지에 덮이지 않도록 수정
- 재시도와 provider 범위 중복 제거 테스트 추가

대체 사이트 scraper는 의도적으로 넣지 않았다. 공개 API·안정적인 URL 계약·자동화 허가가 확인되지 않은 사이트를 자동화하면 쉽게 깨질 뿐 아니라 CAPTCHA와 운영자 제한을 우회하는 결과가 될 수 있기 때문이다. 현재 adapter seam 위에 Internet Archive처럼 문서화된 공급원을 추가하거나, BMS SEARCH/manbow에서 사용자가 고른 공식 링크를 host adapter로 넘기는 방식이 안전하다.

## 운영 권장값

- 동시 다운로드: 1
- 정상 항목 사이 지연: 현재 5초 유지
- 일시 오류 재시도: 최대 3회, 지수 backoff + jitter
- 429: 즉시 중단, `Retry-After` 또는 서버 reset time까지 queue 보존
- 4xx: 408/425를 제외하고 자동 재시도하지 않음
- 중복 제거: provider + type + remote ID, 가능하면 SHA-256도 보조키로 사용
- 대형 묶음: 공식 torrent와 package를 우선
- 브라우저 기본 다운로드: “요청됨”으로만 기록
- 선택 폴더 모드: 스트림 완료 후 기록하고, HTML/JSON 오류 응답을 거부

## 확인한 주요 자료

- BMS Library 홈페이지와 대형 패키지 안내: <https://horieyuuka.github.io/>
- BMS Library 면책·권리 안내: <https://horieyuuka.github.io/Disclaimer>
- BMS Library 공식 프런트엔드 소스: <https://github.com/HorieYuuka/HorieYuuka.github.io/blob/main/assets/js/site-interactions.js>
- BMS SEARCH 소개: <https://note.com/bmssearch/n/n8dc8238b26b4>
- manbow 이벤트 URLList 예시: <https://manbow.nothing.sh/event/event.cgi?action=URLList&event=140>
- BMSworld: <https://www.bmsworld.nz/>
- Internet Archive 자동 접근 지침: <https://archive.org/developers/bots.html>
- Internet Archive item/download URL 지침: <https://archive.org/developers/items.html>
- Pixeldrain API: <https://pixeldrain.com/api>
- Google Drive API quota: <https://developers.google.com/workspace/drive/api/guides/limits>
- Dropbox 강제 다운로드 링크: <https://help.dropbox.com/share/force-download>
- Chrome 자동 다운로드 설정: <https://support.google.com/chrome/answer/95759>
