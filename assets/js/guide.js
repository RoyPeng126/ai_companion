(function () {
  const buttons = document.querySelectorAll('button[data-read]');

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      alert('此裝置不支援語音朗讀，請改以文字閱讀');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => speak(button.getAttribute('data-read')));
  });
})();
