# 지현제네 iCloud 캘린더 연동 (Firebase Spark)

기존 `family-meeting-log` 프로젝트의 Firebase Authentication과 Firestore만 사용합니다.
아이폰 단축어가 선택한 iCloud 캘린더의 조회 결과 전체를 기기별로 교체합니다.
수정·삭제 및 캘린더 선택 변경은 해당 아이폰의 다음 성공한 실행에 반영됩니다.
웹에서는 승인된 Google 계정 두 개만 가져온 일정을 읽을 수 있습니다.

## Firebase 콘솔에서 한 번 설정

1. **Authentication → 로그인 방법**: Google과 이메일/비밀번호를 켭니다.
   **설정 → 승인된 도메인**에 `jkm29.github.io`를 추가합니다.
2. 지현·현제가 각각 Google로 한 번 로그인한 뒤 **Authentication → 사용자**에서 Google 사용자 UID를 확인합니다. 로그인 UI를 먼저 배포해 계정을 등록하는 경우, 규칙이 적용될 때까지 로그인해도 일정은 표시되지 않으며 아이폰에서는 아직 업로드하지 않습니다.
3. **사용자 추가**로 아이폰 전용 이메일/비밀번호 계정을 만듭니다. 웹 조회 계정과 별개이며, 비밀번호는 강력하고 기기별로 다르게 정합니다. 이 계정의 UID도 확인합니다.
4. [규칙 예시](firestore.rules.example)의 UID를 교체하고, 기존 Firestore 규칙의 `match /databases/{database}/documents` 안에 새 블록만 추가합니다. 기존 대시보드·가계부 경로 규칙은 유지합니다. `calendarSnapshots`에 전체 읽기·쓰기를 허용하는 다른 규칙이 없어야 합니다.
   - 미로그인 및 다른 Google 사용자: 읽기·쓰기 모두 거부
   - 두 Google 사용자: 읽기만 허용
   - 각 단축어 계정: 자기 UID 문서 생성·갱신만 허용
5. 사이트 설정 `log/calendar-sync-config.js`의 값을 `true`로 바꾸면 월별 일정 페이지에서 **Google로 로그인** 버튼이 나타납니다. 규칙 검증 후 실제 일정 없이 빈 목록으로 먼저 시험하세요.

## 아이폰 단축어 만들기

1. 시작과 동시에 **현재 날짜**를 ISO 8601로 기록합니다. 이 값을 `capturedAt`에 사용합니다.
2. **캘린더 이벤트 찾기**에서 공유할 iCloud 캘린더를 지정합니다. 여러 개를 공유하려면 캘린더별 찾기 동작을 추가해 결과를 한 목록으로 합칩니다. 각 조회에는 동일한 기간을 적용합니다. 예를 들어 **종료가 오늘 시작 이후이고 시작이 90일 뒤 자정 이전**인 일정으로 설정하면 진행 중인 여러 날 일정도 포함됩니다. 개수 제한은 끕니다.
3. 각 이벤트를 제목, 캘린더 이름, 시작일, 종료일이 든 사전으로 만듭니다. 날짜는 서울 시간대의 `yyyy-MM-dd`를 사용합니다. 종료일은 마지막으로 실제 표시할 날짜입니다. 종료가 다음 날 자정으로 표시되는 일정은 종료 시각에서 1초를 빼고 날짜로 바꾸세요. 이 사전 목록을 JSON 배열 텍스트로 직렬화합니다. 수동으로 따옴표를 이어 붙이지 않고 JSON으로 변환해야 일정 제목의 따옴표와 줄바꿈도 그대로 전송됩니다.

   ```json
   [{"title":"장보기","calendar":"가족","start":"2026-11-16","end":"2026-11-16"}]
   ```

4. 모든 캘린더 조회에 성공한 경우에만 **URL 콘텐츠 가져오기**로 다음 주소에 JSON을 **POST**합니다. `WEB_API_KEY`는 기존 앱이 사용하는 Firebase 웹 API 키입니다. 계정 비밀번호가 들어간 단축어는 공유하거나 저장소에 올리지 마세요.

   `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=WEB_API_KEY`

   ```json
   {"email":"아이폰 전용 계정","password":"이 기기 전용 비밀번호","returnSecureToken":true}
   ```

5. 로그인 응답의 `idToken`과 `localId`를 사용합니다. **URL 콘텐츠 가져오기**로 아래 주소에 **PATCH**하며, 헤더 `Authorization`을 `Bearer ID_TOKEN`으로 설정합니다. 본문 유형은 JSON입니다. `eventsJson.stringValue`에는 3단계의 배열을 **텍스트 값**으로 지정합니다. `capturedAt.timestampValue`에는 1단계의 시각을 지정합니다. 주소의 `LOCAL_ID`는 로그인 응답의 `localId`입니다.

   `https://firestore.googleapis.com/v1/projects/family-meeting-log/databases/(default)/documents/calendarSnapshots/LOCAL_ID`

   ```json
   {
     "fields": {
       "capturedAt": {"timestampValue":"2026-11-15T11:00:00Z"},
       "eventsJson": {"stringValue":"[{\"title\":\"장보기\",\"calendar\":\"가족\",\"start\":\"2026-11-16\",\"end\":\"2026-11-16\"}]"}
     }
   }
   ```

   성공 응답의 문서에 `updateTime`이 포함됩니다. 조회가 성공했고 일정이 하나도 없으면 텍스트 `[]`를 보내 이전 일정을 비웁니다. 조회나 로그인에 실패했다면 이전 일정을 보존하기 위해 업로드를 중단합니다.
6. 아이폰에서 수동으로 한 번 실행해 권한을 허용합니다. 테스트 일정을 추가·수정·삭제할 때마다 실행해서 웹에 반영되는지 확인한 다음, **단축어 → 자동화 → 특정 시간 → 즉시 실행**에 등록합니다. 예약된 실행이 실패하면 이전 성공 결과가 계속 표시되며, 웹의 최근 동기화 시각으로 확인할 수 있습니다.

두 아이폰에서 서로 다른 캘린더를 보낼 경우 각각 전용 계정을 만들고 두 UID를 규칙에 허용합니다. 둘 다 같은 공유 캘린더를 보낼 필요는 없습니다. 더 이상 쓰지 않는 기기의 일정은 그 기기에서 빈 목록을 한 번 보내거나, Firebase 콘솔에서 해당 문서를 삭제하고 작성 권한을 제거합니다.

참고: [Firebase 로그인 REST API](https://firebase.google.com/docs/reference/rest/auth#section-sign-in-email-password), [Firestore REST API 인증](https://firebase.google.com/docs/firestore/use-rest-api), [Apple 단축어 자동 실행](https://support.apple.com/guide/shortcuts/enable-or-disable-a-personal-automation-apd602971e63/ios).
