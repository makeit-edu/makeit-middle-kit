(() => {
  const notice = document.getElementById('notice');
  let timer;
  const prompt = document.getElementById('change-prompt');
  const boundary = ' 글 내용은 그대로 두고, 라이선스·광고·초기화 기능은 건드리지 마.';
  const choices = {
    reading: prompt.textContent,
    mobile: '메킷애센을 휴대폰에서 보기 좋게 고쳐줘. 휴대폰에서 목차·관련 글·이미지가 겹치거나 화면 밖으로 넘치는 곳을 먼저 찾아서 알려주면 내가 하나 고를게.' + boundary,
    speed: '메킷애센 때문에 느린 부분이 있는지 봐줘. PageSpeed 결과 화면을 줄 테니 메킷애센 안에서 고칠 수 있는 원인 하나만 찾아서 제안해줘. 광고·통계·라이선스를 빼는 방법은 빼줘.'
  };
  document.querySelectorAll('[name="upgrade"]').forEach(input => input.addEventListener('change', () => {
    prompt.textContent = choices[input.value];
    document.getElementById('speed-first').hidden = input.value !== 'speed';
    if (input.value === 'speed') document.getElementById('speed-guide').open = true;
    announce('고른 항목의 문장으로 바꿨어요.');
  }));
  function announce(message) {
    notice.textContent = message;
    notice.classList.add('visible');
    clearTimeout(timer);
    timer = setTimeout(() => notice.classList.remove('visible'), 3500);
  }
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copy);
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        announce('복사했어요. 코덱스 채팅창에 붙여넣으세요.');
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
        announce('문장을 선택했어요. 직접 복사해 주세요.');
      }
    });
  });
  document.getElementById('build-prompt').addEventListener('click', () => {
    const idea = document.getElementById('idea');
    if (!idea.value.trim()) {
      announce('바꾸고 싶은 것 한 가지를 먼저 적어 주세요.');
      idea.focus();
      return;
    }
    document.getElementById('own-prompt').textContent = '메킷애센을 이렇게 고쳐줘: ' + idea.value.trim() + boundary;
    document.getElementById('personal-result').hidden = false;
    announce('요청문을 만들었어요. 아래 복사 버튼을 누르세요.');
  });
})();
