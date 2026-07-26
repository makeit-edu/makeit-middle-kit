#!/usr/bin/env bash
# ============================================================================
# 한글 명령들이 공유하는 안전장치 (실행용이 아니라 source 용)
#
# 왜 필요한가:
#   키트 템플릿은 Public 이라 수강생도 원본 저장소에 바로 작업방을 만들 수 있다.
#   만들어지긴 하지만 쓰기 권한이 없어 '저장'이 거부되고, 30일 뒤 작업방이
#   사라질 때 작업물이 통째로 없어진다. 본인은 잘 되는 줄 알고 몇 주를 쓴 뒤에야
#   안다. welcome.sh 가 첫 화면에서 경고하지만, 경고를 지나친 사람이 실제로
#   작업을 시작하지는 못하게 여기서 한 번 더 막는다.
# ============================================================================

# 원본 템플릿 저장소에서 실행 중이면 안내하고 중단시킨다.
#   $1 = 저장소 루트 경로
#   MAKEIT_KIT_MAINTAINER=1 이면 통과 (운영진이 원본에서 점검할 때)
guard_template_repo() {
  local root="${1:-.}"
  local template="makeit-edu/makeit-middle-kit"
  local origin
  origin="$(git -C "$root" remote get-url origin 2>/dev/null)"

  case "$origin" in
    *"$template"*) ;;
    *) return 0 ;;
  esac

  [ "${MAKEIT_KIT_MAINTAINER:-}" = "1" ] && return 0

  local B="" OFF="" RED="" CYAN="" NGBG=""
  if [ -t 1 ] && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    B=$'\033[1m'; OFF=$'\033[0m'; RED=$'\033[1;31m'; CYAN=$'\033[1;36m'
    NGBG=$'\033[41;97m\033[1m'
  fi

  echo ""
  echo "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${OFF}"
  echo ""
  echo "   ${NGBG}  ⚠️  여 기 서 는   작 업 할   수   없 어 요  ${OFF}"
  echo ""
  echo "   지금 열린 곳은 ${B}원본 키트${OFF}예요. 내 작업방이 아닙니다."
  echo "   여기서 만든 영상과 글은 ${B}저장되지 않고 나중에 전부 사라집니다.${OFF}"
  echo "   그래서 시작하기 전에 멈췄어요."
  echo ""
  echo "   ${B}내 작업방을 만들어 주세요. 2분이면 됩니다.${OFF}"
  echo ""
  echo "     ${CYAN}1)${OFF} 아래 주소를 열기 ${B}(내 저장소 만들기 화면이 바로 열려요)${OFF}"
  echo "        ${B}https://github.com/new?template_name=makeit-middle-kit&template_owner=makeit-edu${OFF}"
  echo "     ${CYAN}2)${OFF} 이름을 정하고 ${B}Private${OFF} 확인 → ${B}Create repository${OFF}"
  echo "     ${CYAN}3)${OFF} 새로 만든 ${B}내 저장소${OFF}에서 ${B}Code → Codespaces → Create${OFF}"
  echo "     ${CYAN}4)${OFF} 지금 이 작업방은 ${B}github.com/codespaces${OFF} 에서 지우기"
  echo ""
  echo "   ${B}안내서 9~14번${OFF} 그대로입니다."
  echo ""
  echo "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${OFF}"
  echo ""
  exit 1
}
