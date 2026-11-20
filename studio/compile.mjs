import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { readRxdataFile, readRxdataRaw, toRuby } from 'rpgmaker-xp-mcp/dist/utils/rxdata.js';
import { dump } from 'rpgmaker-xp-mcp/dist/vendor/marshal/index.js';
import { makeAudioFile, makeMap, makeMapInfo, makeEventPage, makeEventCommand } from 'rpgmaker-xp-mcp/dist/utils/types.js';

export const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const integer = (value, min, max, label) => {
  assert(Number.isInteger(value) && value >= min && value <= max, `${label} must be an integer in ${min}..${max}`);
  return value;
};
const string = (value, label) => {
  assert(typeof value === 'string' && value.trim() && !value.includes('\0'), `${label} must be a nonempty string`);
  return value;
};
const each = (value, label, min = 0, max = Infinity) => {
  assert(Array.isArray(value) && value.length >= min && value.length <= max, `${label} must be an array with ${min}..${max} entries`);
  return value;
};

export const mapFile = id => `Map${String(id).padStart(3, '0')}.rxdata`;
export const readMap = (dir, id) => readRxdataFile(join(dir, 'Data', mapFile(id)));
export const readDb = (dir, name) => readRxdataFile(join(dir, 'Data', `${name}.rxdata`));
const writeDb = (dir, file, data) => writeFile(join(dir, 'Data', file), dump(toRuby(data)));
export const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));

export async function insertScript(project, name, source, beforeMain = true) {
  const path = join(project, 'Data', 'Scripts.rxdata');
  const scripts = await readRxdataRaw(path);
  const main = scripts.findIndex(row => Buffer.from(row[1]).toString('utf8') === 'Main');
  assert(!beforeMain || main >= 0, 'Scripts.rxdata has no Main section');
  const id = Math.max(0, ...scripts.map(row => row[0])) + 1;
  scripts.splice(beforeMain ? main : 0, 0, [id, Buffer.from(name), deflateSync(source)]);
  await writeFile(path, dump(scripts));
}

function position(point, maps, label) {
  assert(point && typeof point === 'object', `${label} must specify map, x and y`);
  const map = maps.get(point.map);
  assert(map, `${label} references unknown map ${point.map}`);
  return [
    map.id,
    integer(point.x, 0, map.width - 1, `${label}.x`),
    integer(point.y, 0, map.height - 1, `${label}.y`),
  ];
}

const audio = (name, volume = 80) => makeAudioFile(string(name, 'audio asset name'), volume);

function commands(list, context, depth = 0) {
  assert(depth <= 12, 'Event nesting exceeds 12 levels');
  const { maps, switches, items, troops } = context;
  const cmd = (code, ...params) => makeEventCommand(code, depth, params);
  const branch = body => [...commands(body, context, depth + 1), makeEventCommand(0, depth + 1)];
  const switchId = id => {
    integer(id, 1, switches.length - 1, 'switch id');
    assert(switches[id], `Switch ${id} must be named in the specification`);
    return id;
  };
  return each(list, 'commands', 0, 2000).flatMap(step => {
    assert(step && typeof step === 'object', 'Each command needs an op');
    switch (step.op) {
      case 'text': {
        const lines = string(step.text, 'text').split('\n');
        return lines.map((line, i) => cmd(i % 4 === 0 ? 101 : 401, line));
      }
      case 'choice': {
        const options = each(step.options, 'choice.options', 1, 4);
        return [
          cmd(102, options.map(option => string(option.text, 'choice text')), 0),
          ...options.flatMap((option, i) => [cmd(402, i, option.text), ...branch(option.commands ?? [])]),
          cmd(404),
        ];
      }
      case 'switch': {
        const id = switchId(step.id);
        assert(typeof step.on === 'boolean', 'switch.on must be a boolean');
        return [cmd(121, id, id, step.on ? 0 : 1)];
      }
      case 'if_switch':
        return [
          cmd(111, 0, switchId(step.id), 0), ...branch(step.then ?? []),
          ...(step.else ? [cmd(411), ...branch(step.else)] : []), cmd(412),
        ];
      case 'transfer': {
        const direction = step.direction ?? 0;
        assert([0, 2, 4, 6, 8].includes(direction), 'transfer.direction must be 0, 2, 4, 6 or 8');
        return [cmd(201, 0, ...position(step.to, maps, 'transfer.to'), direction, 0)];
      }
      case 'gold': {
        const amount = integer(step.amount, -999999, 999999, 'gold.amount');
        return [cmd(125, amount < 0 ? 1 : 0, 0, Math.abs(amount))];
      }
      case 'item': {
        assert(items[step.id], `Unknown item ${step.id}`);
        const count = integer(step.count ?? 1, -99, 99, 'item.count');
        return [cmd(126, Number(step.id), count < 0 ? 1 : 0, 0, Math.abs(count))];
      }
      case 'battle':
        assert(troops[step.troop], `Unknown troop ${step.troop}`);
        return [
          cmd(301, Number(step.troop), false, false),
          cmd(601), ...branch(step.win ?? []), cmd(604),
        ];
      case 'sound':
        return [cmd(250, audio(step.name))];
      case 'game_over':
        return [cmd(353)];
      case 'title':
        return [cmd(354)];
      default:
        throw new Error(`Unknown event operation: ${step.op}`);
    }
  });
}

export async function compile(project, spec) {
  assert(spec?.version === 1, 'Expected RPGXP Agent Studio specification version 1');
  const maps = new Map();
  const [system, tilesets, actors, items, troops] = await Promise.all(
    ['System', 'Tilesets', 'Actors', 'Items', 'Troops'].map(name => readDb(project, name))
  );
  const infos = {};
  for (const raw of each(spec.maps, 'maps', 1, 999)) {
    assert(/^[a-z][a-z0-9_-]{0,47}$/.test(raw.key ?? '') && !maps.has(raw.key), `Invalid or duplicate map key: ${raw.key}`);
    const width = integer(raw.width, 20, 500, `${raw.key}.width`);
    const height = integer(raw.height, 15, 500, `${raw.key}.height`);
    const tilesetId = integer(raw.tileset ?? 1, 1, tilesets.length - 1, `${raw.key}.tileset`);
    assert(tilesets[tilesetId]?.tileset_name, `Unconfigured tileset ${tilesetId}`);
    const map = makeMap(width, height, tilesetId);
    maps.set(raw.key, { id: maps.size + 1, width, height, raw, map });
  }
  [system.start_map_id, system.start_x, system.start_y] = position(spec.start, maps, 'start');
  for (const [key, name] of Object.entries(spec.switches ?? {})) {
    const id = integer(Number(key), 1, 5000, 'switch id');
    while (system.switches.length <= id) system.switches.push('');
    system.switches[id] = string(name, `switch ${id}`);
  }
  if (spec.party) {
    system.party_members = each(spec.party, 'party', 1, 4).map(id => {
      assert(Number.isInteger(id) && actors[id], `Unknown starting actor ${id}`);
      return id;
    });
  }
  if (spec.heroName) actors[system.party_members[0]].name = string(spec.heroName, 'heroName');

  for (const { id, raw, map, width, height } of maps.values()) {
    infos[id] = makeMapInfo(string(raw.name, `${raw.key}.name`), 0, id);
    const tileset = tilesets[map.tileset_id];
    const tile = value => {
      integer(value, 0, tileset.passages.data.length - 1, `${raw.key} tile`);
      assert(value === 0 || value >= 384 || (value >= 48 && tileset.autotile_names[Math.floor(value / 48) - 1]), `Invalid tile ${value} in ${raw.key}`);
      return value;
    };
    map.data.data.fill(tile(raw.floor), 0, width * height);
    const legend = Object.fromEntries(Object.entries(raw.legend ?? {}).map(([symbol, value]) => [symbol, tile(value)]));
    for (const layer of each(raw.layers ?? [], 'layers', 0, 3)) {
      const z = integer(layer.z, 0, 2, 'layer.z');
      each(layer.rows, 'layer.rows', height, height).forEach((line, y) => {
        const row = Array.from(line);
        assert(row.length === width, `${raw.key} layer ${z}, row ${y}: expected ${width} cells`);
        row.forEach((symbol, x) => {
          if (symbol === '.') return;
          assert(Object.hasOwn(legend, symbol), `Unknown tile symbol '${symbol}' at ${raw.key} ${x},${y},${z}`);
          map.data.data[z * width * height + y * width + x] = legend[symbol];
        });
      });
    }
    if (raw.bgm) {
      map.autoplay_bgm = true;
      map.bgm = audio(raw.bgm, 65);
    }

    const context = { maps, switches: system.switches, items, troops };
    for (const [index, ev] of each(raw.events ?? [], 'events', 0, 999).entries()) {
      const [, x, y] = position({ ...ev, map: raw.key }, maps, `${raw.key} event ${index + 1}`);
      const pages = each(ev.pages, 'event.pages', 1, 99).map(page => {
        const result = makeEventPage();
        const trigger = page.trigger ?? 'action';
        const triggers = ['action', 'touch', 'event_touch', 'autorun', 'parallel'];
        result.trigger = triggers.indexOf(trigger);
        assert(result.trigger >= 0, `Unknown trigger ${trigger}`);
        if (page.switch !== undefined) {
          const sw = integer(page.switch, 1, system.switches.length - 1, 'page.switch');
          assert(system.switches[sw], `Switch ${sw} must be named in the specification`);
          result.condition.switch1_valid = true;
          result.condition.switch1_id = sw;
        }
        if (page.sprite) result.graphic.character_name = string(page.sprite, 'page.sprite');
        result.through = page.through ?? false;
        assert(typeof result.through === 'boolean', 'page.through must be boolean');
        if (page.direction !== undefined) {
          assert([2, 4, 6, 8].includes(page.direction), 'page.direction must be 2, 4, 6 or 8');
          result.graphic.direction = page.direction;
          result.direction_fix = true;
        }
        result.list = [...commands(page.commands ?? [], context), makeEventCommand()];
        return result;
      });
      map.events[index + 1] = { _class: 'RPG::Event', id: index + 1, name: string(ev.name, 'event.name'), x, y, pages };
    }
    await writeDb(project, mapFile(id), map);
  }
  await writeDb(project, 'MapInfos.rxdata', infos);
  await writeDb(project, 'System.rxdata', system);
  if (spec.heroName) await writeDb(project, 'Actors.rxdata', actors);
  if (spec.font) {
    assert(/^[a-zA-Z0-9 -]{1,64}$/.test(spec.font), 'font must be a Windows font family name');
    await insertScript(project, 'Game font', `Font.default_name = ["${spec.font}", "Arial"]\n`);
  }
  return Object.fromEntries([...maps].map(([key, info]) => [key, info.id]));
}
