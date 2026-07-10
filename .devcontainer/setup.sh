#!/usr/bin/env bash
# ============================================================================
# 월부 중급반 키트 — Codespace 설치 스크립트 (PRD 5-2·D11)
#
# 모드 (devcontainer.json 이 단계별로 호출):
#   --prebuild : onCreateCommand      — apt·npm ci·Codex 설치·Headless Shell (prebuild 에 구워짐)
#   --update   : updateContentCommand — npm ci 재확인 (prebuild 갱신 시)
#   --user     : postCreateCommand    — config.toml·PATH·.env.local 템플릿·upstream (사용자별 단계)
#   (인자 없음): 전체 실행 (하위 호환 — 수동 복구용)
#
# 원칙: 한 단계가 실패해도 멈추지 않고 끝까지 진행한 뒤,
#       실패한 단계 요약을 마지막에 출력한다. (PRD 4-1 3단계 — 환경 관문은
#       postCreate 실패의 연쇄 오류를 막기 위해 '진단' 명령으로 별도 확인)
# ============================================================================

set -u   # 미정의 변수만 오류 처리. set -e 는 쓰지 않는다(실패해도 다음 단계 진행).

MODE="${1:-all}"

# 저장소 루트: 이 스크립트(.devcontainer/setup.sh) 기준 상위 폴더
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROGRAM_DIR="$ROOT/99_절대_건들지마세요_프로그램파일"
REMOTION_DIR="$PROGRAM_DIR/video-workspace/remotion-ui"
CODEX_RUNTIME_DIR="$PROGRAM_DIR/runtime/codex"

FAILED=()   # 실패한 단계 이름 누적

# 단계 실행 헬퍼: 실패해도 기록만 하고 계속 진행
run_step() {
  local name="$1"; shift
  echo ""
  echo "──────────────────────────────────────────────"
  echo "▶ $name"
  echo "──────────────────────────────────────────────"
  if "$@"; then
    echo "✔ $name — 완료"
  else
    echo "✖ $name — 실패 (다음 단계로 계속 진행합니다)"
    FAILED+=("$name")
  fi
}

# ----------------------------------------------------------------------------
# (a) Remotion 리눅스 렌더용 시스템 라이브러리 설치 (+ '내보내기'용 zip)
#     목록 출처: Remotion 공식 Docker 가이드(Debian bookworm 기준) — PRD 5-2 확정 목록.
#     ※ 3·4주차 확장을 rebuild 없이 흡수하도록 의존성은 상위 집합으로 고정 (PRD 5-9)
# ----------------------------------------------------------------------------
step_apt() {
  sudo apt-get update -y && sudo apt-get install -y --no-install-recommends \
    zip \
    unzip \
    curl \
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libgbm-dev \
    libasound2 \
    libxrandr2 \
    libxkbcommon-dev \
    libxfixes3 \
    libxcomposite1 \
    libxdamage1 \
    libatk-bridge2.0-0 \
    libcups2 \
    libcairo2 \
    libpango-1.0-0
}

# ----------------------------------------------------------------------------
# (a-2) 한글 폰트 설치 — 영상 자막용
#     맥(Apple SD Gothic Neo)·윈도우(맑은 고딕)는 OS 폰트에 무임승차했지만
#     리눅스 컨테이너에는 한글 폰트가 하나도 없어 자막이 전부 네모(□)로 렌더된다.
#     상업적 사용이 자유로운 무료 폰트만 담는다.
# ----------------------------------------------------------------------------
step_fonts() {
  sudo apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-noto-cjk \
    fonts-noto-cjk-extra \
    fonts-nanum \
    fonts-nanum-extra \
    fonts-unfonts-core

  # Pretendard — 애플 시스템 폰트와 가장 비슷한 무료 폰트(SIL OFL). apt 저장소에 없어 직접 받는다.
  # 내려받기에 실패해도 위 폰트들로 자막이 렌더되므로 설치를 중단하지 않는다.
  local pretendard_dir="/usr/share/fonts/truetype/pretendard"
  if [ ! -d "$pretendard_dir" ]; then
    local tmp
    tmp="$(mktemp -d)"
    if curl -fsSL --retry 2 -o "$tmp/pretendard.zip" \
      "https://github.com/orioncactus/pretendard/releases/download/v1.3.9/Pretendard-1.3.9.zip"; then
      if unzip -q -o "$tmp/pretendard.zip" -d "$tmp/unpacked"; then
        sudo mkdir -p "$pretendard_dir"
        sudo find "$tmp/unpacked" -name "*.ttf" -exec cp {} "$pretendard_dir/" \;
        echo "Pretendard 폰트를 설치했습니다."
      fi
    else
      echo "Pretendard 내려받기에 실패했지만, 기본 한글 폰트로 자막은 정상 렌더됩니다."
    fi
    rm -rf "$tmp"
  fi

  sudo fc-cache -f >/dev/null 2>&1 || true
}

# ----------------------------------------------------------------------------
# (b) 프로그램 폴더 의존성 설치 (package-lock.json 기준 재현 가능한 설치)
# ----------------------------------------------------------------------------
step_npm_program() {
  npm ci --prefix "$PROGRAM_DIR" --no-audit --no-fund
}

# ----------------------------------------------------------------------------
# (c) 영상 작업 공간(remotion-ui) 의존성 설치 — Remotion 4.0.438 고정 (lock 기준)
# ----------------------------------------------------------------------------
step_npm_remotion() {
  npm ci --prefix "$REMOTION_DIR" --no-audit --no-fund
}

# ----------------------------------------------------------------------------
# (d) Codex CLI 설치 — runtime/codex 에 npm --prefix 로 격리 설치 (현행 방식 유지)
#     runtime/ 은 .gitignore 대상이라 저장소에 포함되지 않는다.
# ----------------------------------------------------------------------------
step_codex_install() {
  mkdir -p "$CODEX_RUNTIME_DIR"
  npm install --prefix "$CODEX_RUNTIME_DIR" --no-audit --no-fund @openai/codex@latest
}

# ----------------------------------------------------------------------------
# (e) Chrome Headless Shell 사전 다운로드 — 시스템 브라우저 금지 정책 유지 (PRD 5-2)
#     remotion-ui 폴더에서 실행해야 로컬 설치된 remotion CLI 를 사용한다.
# ----------------------------------------------------------------------------
step_headless_shell() {
  (cd "$REMOTION_DIR" && npx remotion browser ensure)
}

# ----------------------------------------------------------------------------
# (f) CODEX_HOME 준비 + config.toml 작성 (D6·D7)
#     - 모델 설정은 config.toml 하나로 일원화 (기존 런처의 -c 플래그 폐기)
#     - 이미 model 설정이 있으면 존중하고 건드리지 않는다
# ----------------------------------------------------------------------------
step_codex_config() {
  local codex_home="${CODEX_HOME:-$ROOT/.codex}"
  mkdir -p "$codex_home"
  local cfg="$codex_home/config.toml"
  if [ -f "$cfg" ] && grep -qE '^[[:space:]]*model[[:space:]]*=' "$cfg"; then
    echo "기존 모델 설정이 있어 그대로 둡니다: $cfg"
  else
    cat >> "$cfg" <<'EOF'

# 월부 중급반 기본값 (한도 절약형)
model = "gpt-5.4-mini"
model_reasoning_effort = "low"
EOF
    echo "Codex 기본 모델을 한도 절약형(gpt-5.4-mini, low)으로 설정했습니다."
  fi

  # 권한 사전 설정 — 기존 강의의 '전체 권한 주기' 수동 단계를 대체한다.
  # Codex 의 workspace-write 샌드박스는 bubblewrap(bwrap) 으로 user namespace 를 만드는데,
  # Codespaces 컨테이너는 비특권 user namespace 생성을 막아 bwrap 이 항상 실패한다.
  # (openai/codex#16018, #16211 — 컨테이너 안에서는 danger-full-access 가 공식 권장 경로)
  # Codespace 컨테이너 자체가 격리 경계이므로 내부 샌드박스는 끈다.
  if grep -qE '^[[:space:]]*sandbox_mode[[:space:]]*=[[:space:]]*"workspace-write"' "$cfg" 2>/dev/null; then
    # 구버전 설정 마이그레이션: bwrap 오류를 유발하던 workspace-write 를 교체한다
    sed -i.bak -E 's/^[[:space:]]*sandbox_mode[[:space:]]*=.*/sandbox_mode = "danger-full-access"/' "$cfg"
    sed -i.bak -E '/^\[sandbox_workspace_write\]/d; /^network_access[[:space:]]*=/d' "$cfg"
    rm -f "$cfg.bak"
    echo "Codex 샌드박스 설정을 Codespaces 환경에 맞게 교체했습니다."
  fi

  if ! grep -qE '^[[:space:]]*approval_policy[[:space:]]*=' "$cfg" 2>/dev/null; then
    cat >> "$cfg" <<'EOF'

# 승인 질문 없이 진행 (기존 강의의 '전체 권한' 설정과 동일한 경험)
# 컨테이너가 이미 격리 경계라서 내부 샌드박스(bwrap)는 끈다 — Codespaces 에서는 동작 불가.
approval_policy = "never"
sandbox_mode = "danger-full-access"
EOF
    echo "Codex 권한을 사전 설정했습니다 (승인 질문 없이 작업 진행)."
  fi
}

# ----------------------------------------------------------------------------
# (g) 한글 명령(bin/)을 PATH 에 등록 — 터미널에서 '시작', '진단' 등을 바로 입력 가능
#     중복 등록 방지를 위해 마커 주석으로 확인 후 1회만 추가
# ----------------------------------------------------------------------------
step_path() {
  local marker="# 월부 중급반 키트 한글 명령 (makeit-middle-kit bin)"
  local rc="$HOME/.bashrc"
  touch "$rc"
  if grep -qF "$marker" "$rc"; then
    echo "PATH 등록이 이미 되어 있습니다."
  else
    {
      echo ""
      echo "$marker"
      echo "export PATH=\"$ROOT/bin:\$PATH\""
    } >> "$rc"
    echo "PATH 에 bin/ 을 등록했습니다: $rc"
  fi
}

# ----------------------------------------------------------------------------
# (h) .env.local 템플릿 복사 (PRD 5-1 post-create — 키설정 전 '진단' 이 실패하지 않도록)
#     기존 파일이 있으면 절대 덮어쓰지 않는다.
# ----------------------------------------------------------------------------
step_env_template() {
  if [ -f "$PROGRAM_DIR/.env.local" ]; then
    echo ".env.local 이 이미 있어 그대로 둡니다."
  elif [ -f "$PROGRAM_DIR/.env.example" ]; then
    cp "$PROGRAM_DIR/.env.example" "$PROGRAM_DIR/.env.local"
    echo ".env.local 입력 양식을 만들었습니다. (값은 '키설정' 으로 입력)"
  else
    echo ".env.example 이 없어 건너뜁니다. ('키설정' 실행 시 자동 생성됩니다)"
  fi
}

# ----------------------------------------------------------------------------
# (i) upstream(템플릿 저장소) 원격 등록 (PRD 5-9 1번 — '업데이트' 명령이 사용)
#     package.json 의 config.templateRepo 가 실제 값일 때만 등록한다.
# ----------------------------------------------------------------------------
step_upstream() {
  local repo
  repo="$(node -e "try{console.log(require('$PROGRAM_DIR/package.json').config.templateRepo||'')}catch(e){console.log('')}" 2>/dev/null || echo "")"
  if [ -z "$repo" ] || [[ "$repo" == *"REPLACE_WITH"* ]]; then
    echo "템플릿 저장소 주소가 아직 설정 전이라 건너뜁니다. ('업데이트' 실행 시 다시 시도합니다)"
    return 0
  fi
  if git -C "$ROOT" remote get-url upstream >/dev/null 2>&1; then
    echo "upstream 이 이미 등록되어 있습니다."
  else
    git -C "$ROOT" remote add upstream "$repo" && echo "upstream 을 등록했습니다: $repo"
  fi
}

# ============================================================================
# 실행 순서 (실패해도 전부 시도)
# ============================================================================
case "$MODE" in
  --prebuild)
    echo "월부 중급반 키트 — 기본 설치(prebuild 대상)를 시작합니다."
    run_step "1/6 시스템 라이브러리 설치 (영상 렌더용)"        step_apt
    run_step "2/6 한글 폰트 설치 (영상 자막용)"                step_fonts
    run_step "3/6 프로그램 의존성 설치"                        step_npm_program
    run_step "4/6 영상 프로그램 의존성 설치"                   step_npm_remotion
    run_step "5/6 코덱스(AI 비서) 설치"                        step_codex_install
    run_step "6/6 영상 렌더용 브라우저 준비"                   step_headless_shell
    ;;
  --update)
    # 주의: npm ci 는 node_modules 를 통째로 지우고 다시 설치한다.
    #       렌더용 브라우저(.remotion/)가 node_modules 안에 있어 같이 삭제되므로,
    #       여기서 반드시 다시 확보해야 수강생의 첫 렌더가 86MB 재다운로드로 느려지지 않는다.
    echo "월부 중급반 키트 — 의존성 갱신을 확인합니다."
    run_step "1/3 프로그램 의존성 확인"                        step_npm_program
    run_step "2/3 영상 프로그램 의존성 확인"                   step_npm_remotion
    run_step "3/3 영상 렌더용 브라우저 확인"                   step_headless_shell
    ;;
  --fonts)
    # 폰트 수정 이전에 만들어진 작업방을 고칠 때 쓴다 (새 작업방은 자동 설치됨)
    echo "월부 중급반 키트 — 영상 자막용 한글 폰트를 설치합니다. 2~3분 걸려요."
    sudo apt-get update -y >/dev/null 2>&1 || true
    run_step "1/1 한글 폰트 설치"                              step_fonts
    ;;
  --user)
    echo "월부 중급반 키트 — 사용자별 설정을 준비합니다."
    run_step "1/4 코덱스 기본 설정"                            step_codex_config
    run_step "2/4 한글 명령 등록"                              step_path
    run_step "3/4 키 입력 양식(.env.local) 준비"               step_env_template
    run_step "4/4 업데이트 채널(upstream) 연결"                step_upstream
    ;;
  *)
    echo "월부 중급반 키트 설치를 시작합니다. 3~5분 정도 걸려요. 커피 한 모금 하고 오세요 ☕"
    run_step "1/10 시스템 라이브러리 설치 (영상 렌더용)"       step_apt
    run_step "2/10 한글 폰트 설치 (영상 자막용)"               step_fonts
    run_step "3/10 프로그램 의존성 설치"                       step_npm_program
    run_step "4/10 영상 프로그램 의존성 설치"                  step_npm_remotion
    run_step "5/10 코덱스(AI 비서) 설치"                       step_codex_install
    run_step "6/10 영상 렌더용 브라우저 준비"                  step_headless_shell
    run_step "7/10 코덱스 기본 설정"                           step_codex_config
    run_step "8/10 한글 명령 등록"                             step_path
    run_step "9/10 키 입력 양식(.env.local) 준비"              step_env_template
    run_step "10/10 업데이트 채널(upstream) 연결"              step_upstream
    ;;
esac

# ----------------------------------------------------------------------------
# 실패 요약 — 마지막에 한 번에 출력
# ----------------------------------------------------------------------------
echo ""
echo "=============================================="
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "✅ 이 단계의 설치가 정상적으로 끝났습니다."
  echo "   터미널에 '진단' 을 입력해 [OK] 를 확인해 보세요."
else
  echo "⚠️  설치 중 아래 단계가 실패했습니다:"
  for f in "${FAILED[@]}"; do
    echo "   ✖ $f"
  done
  echo ""
  echo "   → 터미널에 '진단' 을 입력한 뒤, 나온 결과 전체를 복사해서"
  echo "     문의 채널에 올려 주세요. (실패해도 나머지 기능은 쓸 수 있는 경우가 많아요)"
fi
echo "=============================================="

# 설치 스크립트 자체는 항상 성공으로 종료 — 부분 실패는 '진단' 관문에서 걸러낸다 (PRD 4-1)
exit 0
