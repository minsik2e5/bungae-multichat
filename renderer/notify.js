'use strict';

const MAX_CARDS = 4;
const LIFE_MS = 7000;
const stack = document.getElementById('stack');

function report() {
  window.popup.setHeight(stack.children.length ? stack.offsetHeight : 0);
}
new ResizeObserver(report).observe(stack);

function dismiss(card) {
  if (card.classList.contains('out')) return;
  clearTimeout(card.timer);
  card.classList.add('out');
  setTimeout(() => { card.remove(); report(); }, 200);
}

function arm(card) {
  clearTimeout(card.timer);
  card.timer = setTimeout(() => dismiss(card), LIFE_MS);
}

window.popup.onAdd((n) => {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.setProperty('--c', /^#[0-9a-f]{3,8}$/i.test(n.color) ? n.color : '#5B6472');
  card.innerHTML = '<div class="txt"><div class="acc"><span class="a"></span><time></time></div><div class="who"></div><div class="msg"></div></div><button class="x" title="닫기">×</button>';
  card.querySelector('.a').textContent = String(n.account || '');
  card.querySelector('time').textContent = new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  card.querySelector('.who').textContent = String(n.title || '새 메시지');
  card.querySelector('.msg').textContent = String(n.body || '');
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.x')) window.popup.open(String(n.id || ''));
    dismiss(card);
  });
  // 마우스를 올려 두면 사라지지 않음
  card.addEventListener('mouseenter', () => clearTimeout(card.timer));
  card.addEventListener('mouseleave', () => arm(card));
  stack.appendChild(card);
  while (stack.children.length > MAX_CARDS) stack.firstElementChild.remove();
  arm(card);
  report();
});
