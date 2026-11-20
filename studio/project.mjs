import { cp, link, mkdir, mkdtemp, open, readdir, rename, rm, stat, realpath, unlink, writeFile, readFile, copyFile } from 'node:fs/promises';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { assert, compile, readDb, readMap, mapFile } from './compile.mjs';
import { readRxdataRaw } from 'rpgmaker-xp-mcp/dist/utils/rxdata.js';

const here = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse((await readFile(join(here, 'settings.json'), 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return '{}';
})).replace(/^\uFEFF/, ''));

function readRegistry(key, name) {
  if (process.platform !== 'win32') return undefined;
  const powershell = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const lookup = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    `(Get-ItemProperty -LiteralPath '${key}' -Name ${name} -ErrorAction SilentlyContinue).${name}`;
  const { stdout } = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', lookup],
    { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return stdout?.trim() || undefined;
}

function discoverEditor() {
  return readRegistry('HKLM:\\SOFTWARE\\WOW6432Node\\Enterbrain\\RPGXP', 'ApplicationPath');
}

function findRuntimeSource() {
  const adjacent = resolve(here, '..');
  return existsSync(join(adjacent, 'System', 'Game.exe')) ? adjacent : discoverEditor();
}

export const workspace = resolve(process.env.RPGXP_WORKSPACE ?? settings.workspace ?? join(here,'..'));
export const offlineRuntime = join(workspace, '.rpgxp-runtime');
export const install = resolve(process.env.RPGXP_HOME || (existsSync(offlineRuntime) && offlineRuntime) ||
  settings.rpgxp || findRuntimeSource() || offlineRuntime);
export const projects = join(workspace, 'projects');
export const authoringGuide = join(here, '制作接口.md');
export const sample = join(workspace, 'lighthouse.json');

const libraryPattern = /^RGSS10[0-5][A-Z]\.dll$/i;
const hasAssets = root => root && ['Graphics', 'Audio'].every(kind => existsSync(join(root, kind)));

function locateRtp(root, preferred) {
  if (preferred) return resolve(preferred);
  const local = join(root, 'rtp');
  if (hasAssets(local)) return local;
  if (hasAssets(root)) return root;
  // The retail installer can register RTP in a separate directory.
  const standard = existsSync(join(root, 'System', 'Game.exe')) &&
    readRegistry('HKLM:\\SOFTWARE\\WOW6432Node\\Enterbrain\\RGSS\\RTP', 'Standard');
  return hasAssets(standard) ? standard : local;
}

export const rtp = locateRtp(install, install === offlineRuntime ? undefined : process.env.RPGXP_RTP || settings.rtp);

function verifyRuntime(root, assets) {
  for (const file of ['System/Game.exe', 'System/Data/System.rxdata', 'System/Data/Scripts.rxdata']) {
    assert(existsSync(join(root, file)), `找不到 RPG Maker XP 模板 ${file}，已检查 ${root}。可用 cache-runtime 导入本机已有的 XP 安装。`);
  }
  const libraries = readdirSync(root).filter(name => libraryPattern.test(name)).sort().reverse();
  const library = libraries.find(name => name.toUpperCase() === 'RGSS104E.DLL') ?? libraries[0];
  assert(library, `在 ${root} 中找不到 RGSS1 DLL。`);
  assert(hasAssets(assets), `找不到 XP 的 Graphics 和 Audio 素材。已检查 ${assets}。可在 cache-runtime 命令传入 RTP 目录。`);
  return library;
}

export async function prepareOfflineRuntime(source = install, assets) {
  const input = resolve(source);
  if (existsSync(offlineRuntime)) {
    const library = verifyRuntime(offlineRuntime, join(offlineRuntime, 'rtp'));
    return { runtime: offlineRuntime, library, reused: true };
  }
  const assetsRoot = locateRtp(input, assets || process.env.RPGXP_RTP || settings.rtp);
  const library = verifyRuntime(input, assetsRoot);
  const stage = await stagingFolder(workspace, '.runtime-copy-');
  try {
    await cp(join(input, 'System', 'Data'), join(stage, 'System', 'Data'), { recursive: true });
    await copyFile(join(input, 'System', 'Game.exe'), join(stage, 'System', 'Game.exe'));
    await copyFile(join(input, library), join(stage, library));
    for (const kind of ['Graphics', 'Audio']) {
      await cp(join(assetsRoot, kind), join(stage, 'rtp', kind), { recursive: true });
    }
    await rename(stage, offlineRuntime);
    return { runtime: offlineRuntime, library, reused: false };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function stagingFolder(root, prefix) {
  await mkdir(root, { recursive: true });
  const parent = await realpath(root);
  const path = await mkdtemp(join(parent, prefix));
  const actual = await realpath(path);
  assert(dirname(actual).toLowerCase() === parent.toLowerCase(), 'Unexpected staging directory');
  return path;
}

export function projectId(id) {
  assert(typeof id === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(id) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id), 'Use a lowercase ASCII project ID, e.g. lighthouse');
  return id;
}

const locks = new Set();
process.once('exit', () => {
  for (const lock of locks) {
    try { unlinkSync(lock); } catch { /* The lock may already be gone. */ }
  }
});

export async function withProjectLock(id, task) {
  const folder = join(projects, '.locks');
  await mkdir(folder, { recursive: true });
  const lock = join(folder, `${projectId(id)}.lock`);
  let handle;
  try {
    handle = await open(lock, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = await readFile(lock, 'utf8').catch(() => 'starting');
    throw new Error(`Project ${id} is in use by Studio process ${pid}. Retry after it completes. Lock: ${lock}`);
  }
  locks.add(lock);
  try {
    await handle.writeFile(String(process.pid));
    await handle.close();
    return await task();
  } finally {
    await handle.close();
    await unlink(lock);
    locks.delete(lock);
  }
}

export async function getProject(id) {
  const root = await realpath(projects);
  const path = join(root, projectId(id));
  const actual = await realpath(path);
  assert(actual.toLowerCase() === path.toLowerCase(), 'Project folder redirects outside its registered path');
  assert(existsSync(join(path, 'Game.rxproj')) && existsSync(join(path, 'Data', 'System.rxdata')), `Not an XP project: ${path}`);
  return path;
}

export async function listProjects() {
  await mkdir(projects, { recursive: true });
  return (await readdir(projects, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(projects, entry.name, 'Game.rxproj')))
    .map(entry => ({ id: entry.name, directory: join(projects, entry.name) }));
}

async function newProject(id, config, builder) {
  projectId(id);
  const library = verifyRuntime(install, rtp);
  const title = config.windowTitle ?? id;
  assert(typeof title === 'string' && /^[ -~]{1,80}$/.test(title) && !title.includes('"'), 'windowTitle must be a single printable ASCII line without quotes');
  await mkdir(projects, { recursive: true });
  const destination = join(projects, id);
  assert(!existsSync(destination), `Project already exists: ${destination}. Build a new ID to keep both revisions.`);
  const stage = await stagingFolder(projects, '.build-');
  try {
    await cp(join(install, 'System', 'Data'), join(stage, 'Data'), { recursive: true });
    await copyFile(join(install, 'System', 'Game.exe'), join(stage, 'Game.exe'));
    await copyFile(join(install, library), join(stage, library));
    for (const kind of ['Graphics', 'Audio']) {
      await cp(join(rtp, kind), join(stage, kind), { recursive: true });
    }
    await writeFile(join(stage, 'Game.rxproj'), `RPGXP 1.0${library[6]}\r\n`);
    const ini = ['[Game]', `Library=${library}`, 'Scripts=Data\\Scripts.rxdata', `Title=${title}`, 'RTP1=', 'RTP2=', 'RTP3=', ''];
    await writeFile(join(stage, 'Game.ini'), ini.join('\r\n'), 'ascii');
    const details = await builder(stage);
    await rename(stage, destination);
    return { project: id, directory: destination, editorFile: join(destination, 'Game.rxproj'), executable: join(destination, 'Game.exe'), ...details };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function initProject(id, title) {
  return newProject(id, { windowTitle: title }, async () => ({}));
}

export async function buildProject(id, spec) {
  assert(spec?.version === 1, 'Expected RPGXP Agent Studio specification version 1');
  return newProject(id, spec, async dir => {
    const mapIds = await compile(dir, spec);
    const report = await checkProject(dir);
    assert(report.ok, report.errors.join('\n'));
    return { mapIds, ...report };
  });
}

export async function checkProject(dir) {
  const errors = [];
  const [system, infos, tilesets] = await Promise.all(['System', 'MapInfos', 'Tilesets'].map(name => readDb(dir, name)));
  const maps = new Map();
  try {
    const scripts = await readRxdataRaw(join(dir, 'Data', 'Scripts.rxdata'));
    if (!Array.isArray(scripts) || scripts.length === 0) errors.push('Empty or invalid Scripts.rxdata');
  } catch (error) {
    errors.push(error.message);
  }
  for (const id of Object.keys(infos).map(Number)) {
    try { maps.set(id, await readMap(dir, id)); }
    catch (error) { errors.push(`${mapFile(id)}: ${error.message}`); }
  }
  const validPosition = (id, x, y) => {
    const map = maps.get(id);
    return map && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
  };
  if (!validPosition(system.start_map_id, system.start_x, system.start_y)) errors.push('Invalid player start');
  let events = 0;
  for (const [id, map] of maps) {
    if (!tilesets[map.tileset_id]?.tileset_name) errors.push(`Map ${id}: invalid tileset ${map.tileset_id}`);
    const table = map.data;
    if (!table || table.xsize !== map.width || table.ysize !== map.height || table.zsize !== 3 || table.data.length !== map.width * map.height * 3) {
      errors.push(`Map ${id}: invalid tile table dimensions`);
    }
    for (const event of Object.values(map.events ?? {})) {
      events++;
      const label = `Map ${id}, event ${event.id} (${event.name})`;
      if (!validPosition(id, event.x, event.y)) errors.push(`${label}: invalid position`);
      for (const page of event.pages ?? []) {
        const last = page.list?.at(-1);
        if (last?.code !== 0 || last.indent !== 0) errors.push(`${label}: missing event terminator`);
        for (const cmd of page.list ?? []) {
          if (cmd.code === 201 && cmd.parameters[0] === 0 && !validPosition(...cmd.parameters.slice(1, 4))) {
            errors.push(`${label}: invalid transfer destination ${cmd.parameters.slice(1, 4).join(',')}`);
          }
        }
      }
    }
  }
  const { validateAssets } = await import('rpgmaker-xp-mcp/dist/tools/assetTools.js');
  const assets = await validateAssets(dir);
  for (const missing of assets.missing) errors.push(`${missing.kind} ${missing.where}: missing ${missing.expected}`);
  return { ok: errors.length === 0, maps: maps.size, events, assetReferences: assets.checked, errors };
}

export function runProcess(command, args, options = {}) {
  return spawn(command, args, { windowsHide: true, ...options });
}

export async function copyRuntime(source, destination) {
  const ini = await readFile(join(source, 'Game.ini'), 'latin1');
  const library = ini.match(/^Library[ \t]*=[ \t]*([^\r\n]+)/im)?.[1].trim();
  assert(libraryPattern.test(library ?? ''), 'Game.ini must point to a local RGSS1 DLL');
  for (const file of ['Game.exe', library]) {
    await copyFile(join(source, file), join(destination, file));
  }
  const standaloneIni = ini.replace(/^(RTP[123][ \t]*=)[ \t]*([^\r\n]*)/gim, (_, key, value) => {
    assert(!value.trim() || value.trim().toLowerCase() === 'standard', `Custom RTP '${value.trim()}' must be imported as local game assets`);
    return key;
  });
  await writeFile(join(destination, 'Game.ini'), standaloneIni, 'latin1');
  const allowed = ['Data', 'Graphics', 'Audio', 'Fonts'];
  for (const kind of allowed) {
    if ((kind === 'Graphics' || kind === 'Audio') && existsSync(join(rtp, kind))) {
      await cp(join(rtp, kind), join(destination, kind), { recursive: true });
    }
    const src = join(source, kind);
    if (existsSync(src)) {
      await cp(src, join(destination, kind), {
        recursive: true,
        filter: path => !basename(path).startsWith('.') && !/\.(bak|tmp)$/i.test(path),
      });
    }
  }
}

export async function packageProject(id, revision = 'release') {
  const source = await getProject(id);
  projectId(revision);
  const report = await checkProject(source);
  assert(report.ok, report.errors.join('\n'));
  const dist = join(workspace, 'dist');
  await mkdir(dist, { recursive: true });
  const zip = join(dist, `${id}-${revision}.zip`);
  assert(!existsSync(zip), `Archive already exists: ${zip}. Pick a distinct revision.`);
  const stage = await stagingFolder(dist, '.package-');
  try {
    const runtime = join(stage, id);
    const archive = join(stage, 'game.zip');
    await mkdir(runtime);
    await copyRuntime(source, runtime);
    await new Promise((done, fail) => {
      const child = runProcess(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'),
        ['-a', '-cf', archive, '-C', stage, id], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
      child.once('error', fail);
      child.once('close', code => code === 0 ? done() : fail(new Error(stderr || `tar exited ${code}`)));
    });
    await link(archive, zip);
    return { archive: zip, bytes: (await stat(zip)).size, launch: `${id}/Game.exe` };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function launchProject(id, editor = false) {
  const dir = await getProject(id);
  const executable = editor ? findNonSteamEditor() : join(dir, 'Game.exe');
  const child = runProcess(executable,
    editor ? [join(dir, 'Game.rxproj')] : [], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((done, fail) => {
    child.once('spawn', done);
    child.once('error', fail);
  });
  child.unref();
  return { pid: child.pid, project: dir, editor };
}

function findNonSteamEditor() {
  const explicit = process.env.RPGXP_EDITOR || settings.editor;
  assert(!explicit || /[\\/]RPGXP\.exe$/i.test(explicit), '请将 editor 设置为非 Steam 版 RPGXP.exe 的完整路径。');
  const candidates = explicit ? [resolve(explicit)] :
    [join(install, 'RPGXP.exe'), discoverEditor()].filter(Boolean).map(path => path.endsWith('.exe') ? path : join(path, 'RPGXP.exe'));
  for (const item of candidates) {
    const folder = dirname(item);
    const steam = /(?:^|[\\/])steamapps(?:[\\/]|$)/i.test(folder) ||
      ['RPGXP_install.vdf', 'steam_appid.txt'].some(file => existsSync(join(folder, file)));
    if (!steam && existsSync(item)) return item;
  }
  throw new Error('图形编辑器入口需要官方非 Steam 版 RPG Maker XP。可在 studio/settings.json 的 editor 中填写它的 RPGXP.exe 路径。工程生成、试玩和打包可直接使用离线运行库。');
}
