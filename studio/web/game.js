(() => {
  const deltas = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
  const activePage = (event, switches) => event.pages.findLast(page => !page.switch || switches.has(page.switch));

  function createGame(spec, sound = () => {}) {
    const maps = new Map(spec.maps.map(map => [map.key, map]));
    let commands = [];
    const state = { player: {}, switches: new Set(), inventory: {}, gold: 0, dialog: null };
    const map = () => maps.get(state.player.map);
    const eventsAt = (x, y) => map().events.filter(event => event.x === x && event.y === y)
      .map(event => ({ event, page: activePage(event, state.switches) }))
      .filter(entry => entry.page);

    function reset() {
      state.player = { ...spec.start, direction: 2 };
      state.switches.clear();
      state.inventory = {};
      state.gold = 0;
      state.dialog = null;
      commands = [];
    }

    function advance() {
      while (!state.dialog && commands.length) {
        const step = commands.shift();
        switch (step.op) {
          case 'text':
          case 'choice':
            state.dialog = step;
            break;
          case 'switch':
            if (step.on) state.switches.add(step.id);
            else state.switches.delete(step.id);
            break;
          case 'if_switch':
            commands.unshift(...(state.switches.has(step.id) ? step.then ?? [] : step.else ?? []));
            break;
          case 'transfer':
            state.player = { ...step.to, direction: step.direction || state.player.direction };
            break;
          case 'gold':
            state.gold = Math.max(0, state.gold + step.amount);
            break;
          case 'item':
            state.inventory[step.id] = Math.max(0, (state.inventory[step.id] ?? 0) + (step.count ?? 1));
            break;
          case 'sound':
            sound();
            break;
          case 'title':
            reset();
            break;
          case 'game_over':
            state.dialog = { op: 'game_over', text: '旅程到此为止。按确认键重新开始。' };
            break;
        }
      }
    }

    function startEvent(entry) {
      if (!entry) return;
      commands = [...(entry.page.commands ?? [])];
      advance();
    }

    function move(direction) {
      if (state.dialog || !deltas[direction]) return;
      const [dx, dy] = deltas[direction];
      const x = state.player.x + dx, y = state.player.y + dy;
      state.player.direction = direction;
      const target = map();
      if (x < 0 || y < 0 || x >= target.width || y >= target.height || target.blocked[y * target.width + x]) return;
      const events = eventsAt(x, y);
      const solid = events.find(({ page }) => page.sprite && !page.through);
      if (!solid) Object.assign(state.player, { x, y });
      const touch = ({ page }) => ['touch', 'event_touch'].includes(page.trigger);
      startEvent(solid ? (touch(solid) ? solid : null) : events.find(touch));
    }

    function choose(index) {
      const option = state.dialog?.options?.[index];
      if (!option) return;
      state.dialog = null;
      commands.unshift(...(option.commands ?? []));
      advance();
    }

    function confirm() {
      if (state.dialog?.op === 'choice') return;
      if (state.dialog?.op === 'game_over') {
        reset();
        return;
      }
      if (state.dialog) {
        state.dialog = null;
        advance();
        return;
      }
      const { x, y, direction } = state.player;
      const [dx, dy] = deltas[direction];
      const here = eventsAt(x, y).find(({ page }) => !page.sprite && (!page.trigger || page.trigger === 'action'));
      const ahead = eventsAt(x + dx, y + dy).find(({ page }) => page.sprite && (!page.trigger || page.trigger === 'action'));
      startEvent(here ?? ahead);
    }

    reset();
    return { state, map, move, choose, confirm, reset };
  }
  globalThis.createLighthouseGame = createGame;
})();
