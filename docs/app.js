(() => {
  const spec = globalThis.LIGHTHOUSE_DATA;
  const $ = id => document.getElementById(id);
  let soundContext;
  function chime() {
    try {
      soundContext ??= new AudioContext();
      if (soundContext.state === 'suspended') void soundContext.resume().catch(() => {});
      for (const [i, pitch] of [392, 523.25, 659.25].entries()) {
        const time = soundContext.currentTime + i * 0.12;
        const tone = soundContext.createOscillator(), volume = soundContext.createGain();
        tone.type = 'sine';
        tone.frequency.value = pitch;
        volume.gain.setValueAtTime(0.001, time);
        volume.gain.exponentialRampToValueAtTime(0.1, time + 0.025);
        volume.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
        tone.connect(volume).connect(soundContext.destination);
        tone.start(time);
        tone.stop(time + 0.46);
      }
    } catch { /* Sound is optional on devices without Web Audio. */ }
  }
  const game = createLighthouseGame(spec, chime);
  const paint = createLighthouseWorld($('world'));
  const goals = Object.entries(spec.switches ?? {});
  const touch = document.querySelector('.touch');
  const dialog = $('dialog'), options = $('options'), next = $('continue');
  let choice = 0, previous;
  (document.querySelector('h1')).textContent = document.title = spec.web?.title ?? spec.windowTitle ?? 'RPG Maker XP';
  document.querySelector('.masthead p').textContent = spec.web?.intro ?? '';
  for (const [id, label] of goals) {
    const item = document.createElement('li');
    item.dataset.id = id;
    item.textContent = label;
    $('objectives').append(item);
  }

  function render() {
    const { dialog: message, switches, player, gold } = game.state;
    $('map-name').textContent = game.map().name;
    $('reward').textContent = `${gold} G`;
    $('world').dataset.position = `${player.map}:${player.x},${player.y}`;
    for (const item of $('objectives').children) {
      const done = switches.has(Number(item.dataset.id));
      item.classList.toggle('done',done);
      item.setAttribute('aria-label', item.textContent + (done ? '，已完成' : '，未完成'));
    }
    const nextGoal = goals.findIndex(([id])=>!switches.has(Number(id)));
    $('hint').textContent = spec.web?.hints?.[nextGoal < 0 ? goals.length : nextGoal] ?? '';
    dialog.hidden = !message;
    next.hidden = message?.op === 'choice';
    if (message !== previous) {
      choice = 0;
      $('dialog-text').textContent = message?.text ?? '';
      options.replaceChildren();
      message?.options?.forEach((option, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.text;
        button.addEventListener('click',()=>{ game.choose(i); render(); });
        options.append(button);
      });
      previous = message;
    }
    [...options.children].forEach((button,i)=>button.classList.toggle('selected', i===choice));
    $('interact').disabled = message?.op === 'choice';
    for (const button of touch.querySelectorAll('[data-move]')) button.disabled = Boolean(message);
    paint(game, performance.now());
  }

  const directions = {ArrowUp:8,ArrowDown:2,ArrowLeft:4,ArrowRight:6,w:8,s:2,a:4,d:6};
  function confirm() {
    if (game.state.dialog?.op === 'choice') game.choose(choice);
    else game.confirm();
    render();
  }
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const direction = directions[key];
    if (direction) {
      event.preventDefault();
      const message = game.state.dialog;
      if (message?.op === 'choice' && (direction === 2 || direction === 8)) {
        choice = (choice + message.options.length + (direction === 2 ? 1 : -1)) % message.options.length;
      } else game.move(direction);
      render();
    } else if (['Enter','z',' '].includes(key) && !event.repeat) {
      if ((key === 'Enter' || key === ' ') && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      confirm();
    }
  });
  for (const button of touch.querySelectorAll('[data-move]')) {
    button.addEventListener('click',()=>{ game.move(Number(button.dataset.move)); render(); });
  }
  $('interact').addEventListener('click',confirm);
  next.addEventListener('click',confirm);
  $('restart').addEventListener('click',()=>{ game.reset(); render(); });
  render();
})();
