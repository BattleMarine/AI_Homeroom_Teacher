# 강의 재생 데이터 백엔드 API 전환 개발 문서

## 목적

현재 프론트엔드에 남아 있는 강의 더미 재생 리소스의 선택 책임을 백엔드 mock API로 이전하기 위한 개발 범위와 API 계약을 정의한다.

이번 작업은 실제 영상 스트리밍 인프라를 만드는 작업이 아니다. 현재 PNG 기반 모의 강의 화면을 유지하면서, 프론트엔드가 강의별 재생 리소스를 직접 결정하지 않도록 API 경계를 완성하는 것이 목적이다.

## 현재 전환 상태

| 기능 | 현재 기준 |
| --- | --- |
| 커리큘럼 목록·선택 | API 사용 |
| 학생 상태·오늘 수업·커리큘럼 맵 | API 사용 |
| 강의 상세 열기 | API 사용 |
| 강의 피드백·진행률·다음 추천 강의 | API 사용 |
| AI 담임 채팅·조율 제안·확정 | API 사용 |
| 강의 재생 화면 | 프론트엔드 더미 리소스 유지 |
| 데모 단계 이동·초기 예시 수업·일부 진행 보고 계산 | 프론트엔드 mock/규칙 유지 |
| 새로고침 후 데모 상태 | `localStorage` 유지 |

이번 백엔드 작업은 강의별 재생 가능 여부, 리소스 종류, 리소스 API 주소, 재생 시간, mock 미디어 제공을 담당한다. 재생 버튼과 진행 막대 등 화면 상호작용은 계속 프론트엔드가 담당한다.

## 범위

### 포함

```text
기존 강의 상세 API의 playback 계약 확장
강의별 mock 재생 메타데이터 반환
백엔드 소유 mock 미디어 파일 추가
/api 상대 경로를 통한 mock 미디어 응답
성공·오류·콘텐츠 타입 테스트
관련 API 문서 업데이트
```

### 제외

```text
실제 인강 플랫폼과 외부 영상 연동
영상 업로드·인코딩·썸네일 생성
HLS·DASH·HTTP Range 스트리밍
CDN·오브젝트 스토리지·DRM
이어 보기 위치와 실제 재생 시간 저장
```

## 설계 원칙

1. 프론트엔드는 강의 ID로 이미지나 영상을 직접 선택하지 않는다.
2. 프론트엔드는 강의 상세 API의 `playback`만 사용한다.
3. 미디어 주소는 환경과 무관한 `/api` 상대 경로로 반환한다.
4. 바이너리를 JSON의 Base64 문자열로 포함하지 않는다.
5. 예상 학습 시간과 미디어 길이를 별도 값으로 관리한다.
6. PNG 기반 모의 화면을 `mock-video`로 표현하되 실제 형식은 `contentType`으로 명시한다.
7. 요청 경로 변수를 파일 시스템 경로에 직접 연결하지 않는다.

## API 계약

### 강의 상세 조회 확장

기존 엔드포인트를 유지한다.

```text
GET /api/lesson-items/:lessonItemId?studentId={studentId}
```

재생 가능한 강의의 응답 예시:

```json
{
  "lessonItem": {
    "id": "stable-log-graph-asymptote-lecture",
    "kind": "lecture",
    "estimatedMinutes": 9,
    "playback": {
      "kind": "mock-video",
      "targetId": "mock-video:stable-log-graph-asymptote-lecture",
      "mediaType": "image",
      "contentType": "image/png",
      "mediaUrl": "/api/lesson-items/stable-log-graph-asymptote-lecture/playback?studentId=000",
      "durationSeconds": 540
    }
  },
  "dataSource": "mock"
}
```

| 필드 | 의미 |
| --- | --- |
| `kind` | 현재 재생 구현 방식. 이번 단계는 `mock-video`만 사용 |
| `targetId` | 재생 대상의 안정적인 식별자. 파일 경로로 사용하지 않음 |
| `mediaType` | 프론트 렌더링 종류. 현재는 `image` |
| `contentType` | 미디어 API의 HTTP 콘텐츠 타입 |
| `mediaUrl` | 프론트가 가공하지 않고 요청할 `/api` 상대 경로 |
| `durationSeconds` | 모의 플레이어에 표시할 재생 길이 |

`review`, `practice`, `check`처럼 재생 리소스가 없는 항목은 `playback: null`을 반환한다. 호환성을 위해 기존 `playback.kind`, `playback.targetId`, 최상위 `playbackTargetId`는 이번 작업에서 제거하지 않는다.

### 강의 mock 미디어 조회

```text
GET /api/lesson-items/:lessonItemId/playback?studentId={studentId}
```

성공 시 `200`, 강의 상세의 `playback.contentType`과 같은 `Content-Type`, 백엔드 소유 mock 미디어 바이너리를 반환한다. 첫 구현은 현재 더미 PNG이므로 `image/png`를 사용한다.

| 상태 | 조건 |
| --- | --- |
| `400` | `studentId` 또는 경로 변수 형식 오류 |
| `404` | 현재 학생 상태에서 강의 항목을 찾을 수 없음 |
| `404` | 강의는 존재하지만 재생 리소스가 없음 |
| `500` | 등록된 mock 미디어 파일을 읽을 수 없음 |

오류는 기존 JSON 형식을 따르며 실제 파일 경로와 내부 오류 원문을 노출하지 않는다.

## 백엔드 데이터 구조

```ts
type MockLessonPlayback = {
  kind: "mock-video";
  targetId: string;
  mediaType: "image";
  contentType: "image/png";
  assetKey: string;
  durationSeconds: number;
};
```

`assetKey`는 서버 내부 허용 목록을 조회하는 키다. `lessonItemId`를 파일 경로에 직접 결합하지 않는다. 모든 강의가 같은 더미 화면을 사용하더라도 각 강의는 자신의 `targetId`와 `durationSeconds`를 가진다.

## 구현 위치 제안

```text
apps/api/src/progress/  강의 상세 playback 조립과 재생 설정 조회
apps/api/src/           미디어 라우트, 요청 검증, HTTP 응답
apps/api/assets/        백엔드 소유 mock 미디어 파일
apps/api/test/          강의 상세와 미디어 응답 계약 테스트
```

기존 `public/`의 프론트 리소스를 백엔드가 런타임에 참조하지 않는다.

## 구현 순서

1. 강의 mock 데이터에 재생 설정 또는 `assetKey`를 추가한다.
2. 강의 상세 `playback`에 새 메타데이터를 추가한다.
3. 강의와 재생 설정을 검증한 뒤 mock 미디어를 반환하는 라우트를 추가한다.
4. 백엔드 소유 mock 미디어 자산을 추가한다.
5. Fastify 주입 테스트로 JSON 계약과 바이너리 응답을 고정한다.
6. `backend-api-guide.md`의 강의 상세 조회와 전환 순서를 갱신한다.
7. 프론트엔드 세션에 확정 계약과 오류 조건을 전달한다.

## 테스트 요구사항

```text
lecture 상세에 완전한 playback 메타데이터가 포함된다.
mediaUrl은 /api 상대 경로이고 durationSeconds는 양의 정수다.
review, practice, check는 playback이 null이다.
존재하는 lecture의 playback API는 200과 올바른 Content-Type을 반환한다.
존재하지 않는 강의와 재생 불가 항목은 404를 반환한다.
다른 학생 상태에서 접근할 수 없는 강의는 404를 반환한다.
경로 조작 문자열이 서버 파일 경로로 전달되지 않는다.
기존 kind와 targetId 계약이 유지된다.
```

바이너리 전체를 스냅샷으로 저장하지 않는다. 상태 코드, `Content-Type`, 본문 길이, 필요하면 고정 해시만 확인한다.

## 프론트엔드 전달 사항

```text
playback의 새 필드와 타입
mediaType별 렌더링 방법
mediaUrl을 가공하지 않는 원칙
playback이 null인 상태 처리
미디어 API 오류 처리
기존 프론트 더미 리소스 제거 시점
```

프론트엔드는 API 실패 시 기존 더미 리소스로 자동 대체하지 않는다. 실패를 재생 리소스 오류로 표시해 API 경계 문제를 숨기지 않는다.

## 완료 기준

```text
강의 상세 API만으로 재생 가능 여부와 리소스 주소를 알 수 있다.
mock 미디어가 /api 상대 경로로 반환된다.
백엔드가 프론트 public 자산을 참조하지 않는다.
재생 불가 수업 항목이 명확히 구분된다.
기존 강의 상세 응답 호환성이 유지된다.
성공·미존재·재생 불가·경로 조작 시나리오가 테스트된다.
실제 스트리밍과 외부 영상 연동은 범위에 포함되지 않는다.
백엔드 API 가이드와 실제 구현이 일치한다.
```

## 후속 작업

실제 영상을 연결할 때는 애플리케이션 서버의 바이너리 중계를 그대로 확장하지 않는다. 저장소, CDN, 서명 URL, 접근 권한, 구간 재생을 별도로 설계하고 `playback.kind`와 `mediaType`을 확장한다.
