#!/bin/zsh
# 앱/배포.sh "<커밋 메시지>" [버전]
# 1) 프로그램 변경을 커밋  2) 그 커밋 sha 를 목록.json 에 적어 한 번 더 커밋  3) makeit-edu 계정으로 푸시
set -e
cd "$(dirname "$0")/.."
MSG="${1:-앱판 갱신}"
VER="${2:-$(date +%Y-%m-%d)$(python3 -c "import json;v=json.load(open('앱/목록.json')).get('버전','');import datetime;d=datetime.date.today().strftime('%Y-%m-%d');print(chr(ord(v[-1])+1) if v.startswith(d) and v[-1].isalpha() and v[-1]!='z' else 'a')")}"
git add -A
git diff --cached --quiet || git commit -q -m "$MSG"
sha=$(git rev-parse HEAD)
python3 - "$sha" "$VER" <<'PY'
import json,sys,os
sha,ver=sys.argv[1],sys.argv[2]
files=["앱/승인글.mjs","앱/AGENTS.md"]
for root,_,names in os.walk("99_절대_건들지마세요_프로그램파일/scripts"):
    for n in sorted(names):
        if n.endswith(".mjs"): files.append(os.path.join(root,n).replace(os.sep,"/"))
m=json.load(open("앱/목록.json",encoding="utf8"))
m.update({"버전":ver,"커밋":sha,"파일":sorted(set(files))})
json.dump(m,open("앱/목록.json","w",encoding="utf8"),ensure_ascii=False,indent=2)
open("앱/목록.json","a").write("\n")
print("목록:",ver,sha[:8],len(files),"파일")
PY
git add 앱/목록.json
git commit -q -m "앱 목록: 버전 $VER → 커밋 ${sha:0:8}"
gh auth switch -u makeit-edu >/dev/null 2>&1 || true
git push -q origin main && echo "푸시 완료 $(git rev-parse --short HEAD)"
gh auth switch -u dreamyapp >/dev/null 2>&1 || true
