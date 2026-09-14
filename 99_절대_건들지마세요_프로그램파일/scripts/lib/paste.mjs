// 붙여넣기가 값에 섮어 넣는 쓰레기를 걸러낸다.
//
// 터미널은 붙여넣기한 텍스트를 bracketed paste 마커(ESC[200~ … ESC[201~)로
// 감싸서 보낸다. 아래 askHidden 은 raw 모드로 바이트를 직접 읽기 때문에
// 그 마커까지 비밀번호 값에 들어가 버렸고, 그래서 올바른 앱 비밀번호를
// 넣었는데도 401 이 떠서 "비밀번호가 틀리다"는 오진이 나왔다(실측).
export function stripPasteNoise(text) {
  return String(text || "")
    // bracketed paste 시작/끝 마커
    .replace(/\u001b\[20[01]~/g, "")
    // 그 밖의 ESC 시퀀스
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // 남은 제어문자(탭·개행 포함)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

// 사이트 입력을 도중에 그만두고 싶을 때 치는 말.
// (Shift+Enter 같은 조합키는 터미널이 그냥 Enter 와 같은 바이트로 보내서
//  구분할 수가 없다. 그래서 글자로 받는다.)
export const STOP_WORDS = ["끝", "그만", "중지", "종료", "stop", "exit", "q"];
export function isStopWord(value) {
  return STOP_WORDS.includes(stripPasteNoise(value).toLowerCase());
}
