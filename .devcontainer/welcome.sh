#!/usr/bin/env bash
# ============================================================================
# 월부 중급반 키트 — 접속할 때마다 실행되는 환영 안내 (PRD 4-4, 8-R3)
# (devcontainer.json 의 postAttachCommand 가 호출)
#
# 역할: ① 준비가 끝났다는 신호  ② 오늘 할 일(다음 명령)  ③ 커밋 안 된 작업물 경고
#
# 출력 순서가 중요하다. 첫 생성 때는 설치 로그가 수백 줄 흘러간 뒤 이 스크립트가
# 실행되므로, 수강생 눈에 마지막으로 남는 것이 "끝났다"는 신호여야 한다.
# 그래서 명령 목록을 먼저 뿌리고 완료 배너를 맨 마지막에 찍는다.
#
# 어떤 경우에도 오류로 끝나지 않도록 마지막에 exit 0 고정.
# ============================================================================

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROGRAM_DIR="$ROOT/99_절대_건들지마세요_프로그램파일"

# ── 색상: 터미널이 색을 못 쓰면 전부 빈 문자열로 떨어뜨린다 ────────────────
if [ -t 1 ] && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'
  GREEN=$'\033[1;32m'; RED=$'\033[1;31m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[1;36m'
  OKBG=$'\033[42;30m\033[1m'   # 초록 배경 + 검은 글씨
  NGBG=$'\033[41;97m\033[1m'   # 빨강 배경 + 흰 글씨
else
  B=""; DIM=""; OFF=""; GREEN=""; RED=""; YELLOW=""; CYAN=""; OKBG=""; NGBG=""
fi
LINE="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 환경 점검을 먼저 돌려두고, 결과는 맨 마지막에 보여준다 ─────────────────
DOCTOR_OUT="$(cd "$PROGRAM_DIR" 2>/dev/null && node scripts/doctor.mjs 2>/dev/null)"
DOCTOR_OK=$?

# ── 키설정 완료 여부(수강 코드 입력 흔적)로 다음 할 일을 가른다 ─────────────
#    주의: setup.sh 가 깔아두는 .env.local 템플릿에는
#          MAKEIT_MIDDLE_LICENSE=your-course-code 라는 플레이스홀더가 이미 들어 있다.
#          "값이 있으면 입력 완료"로 보면 첫 수강생에게 키설정 안내가 안 나가므로,
#          플레이스홀더는 미입력으로 취급한다. (keys.mjs 의 판정 규칙과 동일)
LICENSE_VALUE="$(grep -E '^MAKEIT_MIDDLE_LICENSE=' "$PROGRAM_DIR/.env.local" 2>/dev/null \
  | head -1 | cut -d= -f2- | tr -d '"'"'"' \t\r\n')"
case "$LICENSE_VALUE" in
  ""|your-*|*placeholder*) FIRST_TIME=1 ;;
  *)                       FIRST_TIME=0 ;;
esac

# ── 원본 템플릿에서 열었는지 감지 ──────────────────────────────────────────
#    템플릿은 Public 이라 수강생도 원본에 바로 작업방을 만들 수 있다. 만들어지긴
#    하지만 쓰기 권한이 없어 '저장'이 거부되고, 30일 뒤 작업방이 사라질 때
#    작업물이 통째로 없어진다. 본인은 잘 되는 줄 알고 몇 주를 쓰게 되므로
#    첫 화면에서 크게 잡아 준다. (원본 주인인 운영진은 정상 작업이라 경고만 한다)
TEMPLATE_REPO="makeit-edu/makeit-middle-kit"
ORIGIN_URL="$(git -C "$ROOT" remote get-url origin 2>/dev/null)"
case "$ORIGIN_URL" in
  *"$TEMPLATE_REPO"*) ON_TEMPLATE=1 ;;
  *)                  ON_TEMPLATE=0 ;;
esac

echo ""
echo "  ${DIM}── 쓸 수 있는 한글 명령 ──────────────────${OFF}"
echo "    ${B}시작${OFF}      AI 비서(코덱스) 켜기"
echo "    ${B}진단${OFF}      뭔가 이상할 때 상태 점검"
echo "    ${B}키설정${OFF}    API 키·수강 코드 입력/변경"
echo "    ${B}저장${OFF}      작업물 안전하게 보관(커밋)"
echo "    ${B}정리${OFF}      용량 확보(완료된 작업 청소)"
echo "    ${B}업데이트${OFF}  프로그램 최신판 받기"
echo "  ${DIM}── 2주차 영상 전용 ───────────────────────${OFF}"
echo "    ${B}새상품 1${OFF}     상품 작업 만들기 (번호 필수)"
echo "    ${B}이미지만들기${OFF}  기획안 기준 이미지 생성"
echo "    ${B}영상만들기${OFF}    음성 + 영상 렌더링"
echo "    ${B}편집기${OFF}        영상 편집기 켜기 (포트 4321)"
echo "    ${B}내보내기${OFF}      완성영상 zip 묶음"
echo "  ${DIM}── 선택 (안 써도 됩니다) ─────────────────${OFF}"
echo "    닮은이미지만들기  내 영상을 참조해 닮은 이미지 생성"
echo "    썸네일후보보기    내 영상 장면에서 썸네일 후보 뽑기"
echo "    이미지바꾸기      장면/썸네일을 내 사진으로 교체"
echo "    이미지되돌리기    교체한 이미지를 원래대로 복원"
echo "    음성미리듣기      자막 고친 뒤 음성만 먼저 확인"
echo "  ${DIM}──────────────────────────────────────────${OFF}"
echo ""
echo "  ${DIM}※ 명령이 안 먹으면 터미널을 새로 열어 주세요. (+ 버튼)${OFF}"

# ── 커밋 안 된 작업물 경고 (30일 미접속 삭제 대비 안전망, 8-R3) ────────────
if git -C "$ROOT" status --porcelain 2>/dev/null | grep -q .; then
  echo ""
  echo "  ${YELLOW}⚠️  아직 저장(커밋)하지 않은 작업물이 있어요!${OFF}"
  echo "      작업이 끝나면 터미널에 ${B}저장${OFF} 을 입력해 주세요."
fi

# ══════════════════════════════════════════════════════════════════════════
# 마지막 화면: 여기까지 왔으면 준비가 끝난 것이다. 크고 분명하게.
# ══════════════════════════════════════════════════════════════════════════
echo ""
if [ $ON_TEMPLATE -eq 1 ]; then
  # 여기서 아무리 잘 만들어도 저장이 안 된다. 다른 안내보다 이게 먼저다.
  echo "${RED}${LINE}${OFF}"
  echo ""
  echo "   ${NGBG}  ⚠️  여 기 서   작 업 하 면   안  됩 니 다  ${OFF}"
  echo ""
  echo "   지금 열린 곳은 ${B}원본 키트${OFF}예요. 내 작업방이 아닙니다."
  echo "   여기서 만든 영상과 글은 ${B}저장되지 않고, 나중에 전부 사라집니다.${OFF}"
  echo ""
  echo "   ${B}지금 바로 이렇게 해주세요.${OFF}"
  echo ""
  echo "     ${CYAN}1)${OFF} 이 작업방을 닫고 ${B}github.com/codespaces${OFF} 에서 지우기"
  echo "     ${CYAN}2)${OFF} 키트 링크에서 ${B}[Use this template]${OFF} → ${B}[Create a new repository]${OFF}"
  echo "     ${CYAN}3)${OFF} 새로 만든 ${B}내 저장소${OFF}에서 작업방 만들기"
  echo ""
  echo "   ${DIM}안내서 9~14번 그대로입니다. (운영진이면 이 경고는 무시하세요)${OFF}"
  echo ""
  echo "${RED}${LINE}${OFF}"
  echo ""
elif [ $DOCTOR_OK -eq 0 ]; then
  echo "${GREEN}${LINE}${OFF}"
  echo ""
  echo "   ${OKBG}  ✅  준 비   완 료  ${OFF}   ${B}설치가 전부 끝났습니다${OFF}"
  echo ""
  if [ $FIRST_TIME -eq 1 ]; then
    echo "   ${B}이제 이 검은 창에 아래 순서대로 입력하세요.${OFF}"
    echo ""
    echo "     ${CYAN}1)${OFF} ${B}키설정${OFF}   ${DIM}← API 키 2개 + 수강 코드를 넣는 단계${OFF}"
    echo "     ${CYAN}2)${OFF} ${B}시작${OFF}     ${DIM}← AI 비서(코덱스)를 켜는 단계${OFF}"
    echo ""
    echo "   ${DIM}안내서의 「열쇠(키) 넣기」 단계입니다.${OFF}"
  else
    echo "   ${B}이제 이 검은 창에${OFF} ${CYAN}시작${OFF} ${B}을 입력하면 바로 작업할 수 있어요.${OFF}"
  fi
  echo ""
  echo "${GREEN}${LINE}${OFF}"
else
  echo "${RED}${LINE}${OFF}"
  echo ""
  echo "   ${NGBG}  ⚠️  확 인   필 요  ${OFF}   ${B}아래 항목이 걸렸습니다${OFF}"
  echo ""
  echo "$DOCTOR_OUT" | grep "확인 필요" | sed "s/^/     /"
  echo ""
  echo "   터미널에 ${B}진단${OFF} 을 입력해, 나온 결과 전체를 복사해서"
  echo "   문의 채널에 올려 주세요."
  echo ""
  echo "${RED}${LINE}${OFF}"
fi
echo ""

exit 0
