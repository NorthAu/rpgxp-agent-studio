import { copyRuntime, getProject, runProcess, stagingFolder, workspace } from './project.mjs';
import { assert, insertScript, integer, readDb } from './compile.mjs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';

const here = dirname(fileURLToPath(import.meta.url));

function routeSteps(route) {
  assert(Array.isArray(route) && route.length >= 1 && route.length <= 250, 'Provide a route with 1..250 steps');
  return route.flatMap(step => {
    assert(step && typeof step === 'object' && Object.keys(step).length === 1, 'Each route step must have one action');
    const [action, value] = Object.entries(step)[0];
    switch (action) {
      case 'move': {
        assert(Array.isArray(value) && value.length === 2 && [2, 4, 6, 8].includes(value[0]), 'move is [direction (2,4,6,8), tiles]');
        return Array.from({ length: integer(value[1], 1, 100, 'tile count') }, () => [action, value[0]]);
      }
      case 'at':
        assert(Array.isArray(value) && value.length === 3, 'at is [mapId, x, y]');
        return [[action, integer(value[0], 1, 999, 'mapId'), integer(value[1], 0, 499, 'x'), integer(value[2], 0, 499, 'y')]];
      case 'switch':
        assert(Array.isArray(value) && value.length === 2 && typeof value[1] === 'boolean', 'switch is [id, boolean]');
        return [[action, integer(value[0], 1, 5000, 'switchId'), value[1]]];
      case 'text':
        assert(typeof value === 'string' && value.length > 0 && value.length <= 512, 'text is a message substring, 1..512 characters');
        return [[action, value]];
      case 'interact':
        assert(value === true, 'interact is true');
        return [[action]];
      case 'choose':
        return [[action, integer(value, 0, 3, 'choice index')]];
      case 'gold':
        return [[action, integer(value, 0, 9999999, 'party gold')]];
      case 'wait':
        return [[action, integer(value, 1, 180, 'wait frames')]];
      default:
        throw new Error(`Unknown route action: ${action}`);
    }
  });
}

// Represent strings as escaped UTF-8 bytes in Ruby 1.8 without Ruby interpolation.
const ruby = value => Array.isArray(value) ? `[${value.map(ruby).join(',')}]` :
  typeof value === 'string' ? '"' + [...Buffer.from(value)].map(byte => `\\x${byte.toString(16).padStart(2,'0')}`).join('') + '"' :
  String(value);

export async function playtest(id, route, timeout = 70) {
  const source = await getProject(id);
  integer(timeout, 5, 180, 'timeoutSeconds');
  const system = await readDb(source, 'System');
  const steps = routeSteps(route ?? [{ at: [system.start_map_id, system.start_x, system.start_y] }]);
  assert(steps.length <= 1000, 'Expanded route exceeds 1000 steps');
  const reports = join(workspace, 'reports');
  const stage = await stagingFolder(reports, '.probe-');
  let child;
  try {
    await copyRuntime(source, stage);
    const script = await readFile(join(here, 'probe.rb'), 'utf8');
    await insertScript(stage, 'Agent Studio playtest', script + `\nStudioProbe.init(${ruby(steps)})\n`);
    child = runProcess(join(stage, 'Game.exe'), [], { cwd: stage, stdio: 'ignore', windowsHide: false });
    const exit = once(child, 'exit');
    let timer;
    let outcome;
    try {
      outcome = await Promise.race([
        exit.then(([code]) => ({ code })),
        new Promise(done => { timer = setTimeout(() => done({ timeout: true }), timeout * 1000); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (outcome.timeout) {
      child.kill();
      await exit;
    }
    const log = await readFile(join(stage, 'studio-probe.result'), 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return outcome.timeout ? `FAIL\nRGSS produced no report within ${timeout}s (possibly a native error dialog or startup failure).` :
        `FAIL\nRGSS exited with code ${outcome.code} before producing a report.`;
    });
    const path = join(reports, `${id}${basename(stage).replace('.probe-', '-')}.txt`);
    await writeFile(path, log);
    const [status, summary] = log.split(/\r?\n/, 2);
    return { ok: status === 'PASS' && !outcome.timeout && outcome.code === 0, summary, steps: steps.length, report: path };
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill();
    await rm(stage, { recursive: true, force: true });
  }
}
