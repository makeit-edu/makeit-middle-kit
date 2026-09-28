# 검색 관련 변경 판단
공식 문서는 정책·기능이 바뀔 수 있으므로 영향을 주는 항목은 작업 시점에 다시 확인한다.

## 화면과 코드를 함께 보기
대표 URL과 해당 템플릿을 연결한다. 저장 HTML, 브라우저 DOM, HTTP 응답 헤더, 관리자 설정은 다른 증거다.
제목·canonical·robots가 소스에 보인다는 사실과 실제 색인 여부를 구분한다. HTTP X-Robots-Tag와 robots.txt도 관련되며 HTML 도구만으로 알 수 없다.

## 요청에 해당하는 부분부터
- 제목: 페이지 목적과 일치하는지, 기존 SEO 플러그인이 이미 출력하는지 확인.
- 내부 링크: 실제 a/href, 이동 대상, 현재 글 제외, 빈 상태, 중복 영역을 확인. URL 변경 시 기존 링크·리디렉션 영향을 따로 검토.
- 색인 지시: 의도적 noindex와 오류를 구분. 전체 제거하지 않는다. robots.txt 차단을 색인 삭제와 혼동하지 않는다.
- 구조화 데이터: 보이는 내용과 일치, 지원 유형·최신 검색 기능 요건 확인. JSON 문법 통과는 Google 적격성 검증이 아니다.
- 이미지·접근성: 대체 텍스트 맥락, 크기 예약, 반응형 이미지와 실제 레이아웃. 빈 alt가 항상 오류는 아니다.
- 성능: 같은 URL·기기·조건의 전후 측정. 실험실 결과와 실제 사용자 데이터 구분.
- 설명·콘텐츠 문제면 코드 추가보다 해당 콘텐츠 또는 설정 수정이 적합할 수 있다.

## 제안 보고
문제 / 확인 위치 / 근거 링크·확인일 / 변경 위치 / 검증 방법 / 미확인 사항.
점수 대신 사용자·검색 접근에 주는 영향을 설명한다. 단순 카드 배치·글자 크기에 순위 상승을 약속하지 않는다.

공식 근거:
- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- https://developers.google.com/search/docs/appearance/structured-data/sd-policies
