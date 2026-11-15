# 지현제네 iCloud 캘린더 연동

기존 달력과 별도의 Firebase 프로젝트에서 가져온 일정만 저장합니다.
웹에서는 승인된 두 Google 계정으로 일정을 조회합니다.
아이폰 단축어는 선택한 iCloud 캘린더의 전체 조회 결과를 보내며,
서버가 이전 조회 결과를 교체합니다.

## Firebase 설정

1. 연동 전용 Firebase 프로젝트를 만들고 Firestore와 Google 로그인, 웹 앱을 설정합니다.
   Authentication의 승인된 도메인에 `jkm29.github.io`를 추가합니다.
2. 제목과 날짜는 서버에서만 읽고 쓰도록 이 폴더의 Firestore 규칙을 사용합니다.
   기존 지현제네 프로젝트에는 이 규칙을 적용하지 않습니다.
3. `openssl rand -hex 32`로 기기마다 서로 다른 키를 만듭니다.
   Secret Manager에 아래 형태로 등록합니다. 실제 값은 저장소에 넣지 않습니다.

   ```json
   {"emails":["first@example.com","second@example.com"],"devices":{"phone1":"64자-hex-키"}}
   ```

   `firebase functions:secrets:set FAMILY_CALENDAR_ACCESS --project PROJECT_ID`
4. 이 폴더에서 `npm --prefix functions install`을 실행한 뒤
   `firebase deploy --only firestore:rules,functions:calendar-sync --project PROJECT_ID`로 배포합니다.
5. `log/calendar-sync-config.js`에 공개 Firebase 웹 앱 설정과 배포된 함수 URL을 입력합니다.

   ```js
   window.familyCalendarSyncConfig = {
     firebase: { apiKey: '...', authDomain: 'PROJECT_ID.firebaseapp.com', projectId: 'PROJECT_ID', appId: '...' },
     endpoint: 'https://asia-northeast3-PROJECT_ID.cloudfunctions.net/familyCalendar'
   };
   ```

## 아이폰 단축어 구성

- 실행을 시작할 때 현재 시각을 ISO 8601로 기록합니다.
- ‘캘린더 이벤트 찾기’에서 보낼 iCloud 캘린더를 고릅니다. 여러 캘린더를 연결할 때는 각 캘린더의 조회 결과를 한 목록으로 합칩니다. 기간 조건은 각 조회에 동일하게 지정하세요. 예를 들어 오늘과 겹치는 일정부터 90일 후까지를 가져올 수 있습니다.
- 조회에 성공한 일정마다 제목, 캘린더 이름, 시작일, 종료일로 사전을 만듭니다. 날짜는 `yyyy-MM-dd` 형식입니다. 종료일은 마지막으로 표시할 날짜입니다. 종일 일정의 종료가 다음 날 자정이라면 하루를 빼고 보냅니다.
- 모든 캘린더 조회가 성공한 뒤에만 ‘URL 콘텐츠 가져오기’에서 함수 URL에 PUT으로 전송합니다. 헤더는 `Authorization: Bearer 기기키`와 `Content-Type: application/json`을 설정합니다.

  ```json
  {
    "capturedAt": "2026-11-15T11:00:00Z",
    "events": [{"title":"장보기","calendar":"가족","start":"2026-11-16","end":"2026-11-16"}]
  }
  ```

- 첫 실행에서 캘린더 및 네트워크 접근을 허용하고 응답을 확인합니다. 이후 시간대 자동화에 이 단축어를 지정합니다.
- 조회에 성공했고 일정이 없다면 `events: []`를 보냅니다. 캘린더 선택을 바꾸면 다음 전송 때 이전 선택의 일정도 제거됩니다.
- 두 아이폰에서 각각 보내는 경우 다른 기기 키를 사용합니다. 두 사람이 동일한 공유 캘린더만 보낸다면 한 아이폰에서 전송하면 됩니다.
