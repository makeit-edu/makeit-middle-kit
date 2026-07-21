// 대화형 질문 공용 헬퍼
//
// 왜 필요한가:
// node:readline 의 rl.question() 은 stdin 이 EOF 로 끝나면 resolve 도 reject 도 하지 않고
// 영원히 pending 상태가 된다. 그러면 이벤트 루프가 비어 Node 가 "unsettled top-level await"
// 경고만 남기고 조용히 종료한다 — try/catch 로도 못 잡는다.
// 수강생이 터미널에 직접 입력할 때는 문제가 없지만,
//   - 실수로 Ctrl+D 를 누르거나
//   - 파이프(`printf "1\n" | 이미지만들기`)로 실행하거나
//   - 자동화 스크립트에서 부를 때
// 아무 안내 없이 작업이 멈춘 것처럼 보인다.
//
// 이 헬퍼는 터미널이 아닌 환경에서 stdin 을 먼저 전부 읽어 줄 단위 큐로 만들고,
// 질문마다 한 줄씩 꺼내 답으로 쓴다. 큐가 비면 빈 문자열을 돌려주어
// 호출부가 준비해 둔 기본값으로 진행하게 한다.
import readline from "node:readline/promises";

let pipedLines = null;

async function loadPipedLines() {
  if (pipedLines) return pipedLines;
  if (process.stdin.isTTY) {
    pipedLines = [];
    return pipedLines;
  }
  const chunks = [];
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch {
    // stdin 을 못 읽어도 기본값 경로로 계속 진행한다
  }
  pipedLines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  return pipedLines;
}

export function createPrompt() {
  const interactive = Boolean(process.stdin.isTTY);
  const rl = interactive ? readline.createInterface({input: process.stdin, output: process.stdout}) : null;

  return {
    interactive,
    async ask(question) {
      if (rl) return rl.question(question);
      const lines = await loadPipedLines();
      const answer = lines.length > 0 ? String(lines.shift()).trim() : "";
      // 터미널이 아니어도 무엇을 물었고 무엇으로 답했는지 로그에 남긴다
      process.stdout.write(`${question}${answer || "(기본값)"}\n`);
      return answer;
    },
    close() {
      if (rl) rl.close();
    },
  };
}
