import { cp, mkdir, mkdtemp, rename, rm, writeFile, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const views = fileURLToPath(new URL('./web/', import.meta.url));
const supported = new Set(['text','choice','switch','if_switch','transfer','gold','item','sound','title','game_over']);
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

function compileWeb(spec) {
  ensure(spec?.version === 1 && spec.maps?.length && spec.start, 'Expected a version 1 game specification');
  const mapByKey = new Map(spec.maps.map(map => [map.key,map]));
  ensure(mapByKey.size === spec.maps.length, 'Duplicate map keys');
  function position(point) {
    const map = mapByKey.get(point?.map);
    ensure(map && Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.y >= 0 && point.x < map.width && point.y < map.height,
      `Invalid world position: ${JSON.stringify(point)}`);
  }
  function validateSteps(steps = []) {
    for (const step of steps) {
      ensure(supported.has(step.op), `Web export does not support event operation '${step.op}'`);
      if (step.op === 'choice') for (const option of step.options) validateSteps(option.commands);
      if (step.op === 'if_switch') {
        validateSteps(step.then);
        validateSteps(step.else);
      }
      if (step.op === 'transfer') position(step.to);
    }
  }

  position(spec.start);
  return { ...spec, maps: spec.maps.map(raw => {
    const { width, height, key, floor, legend = {}, events = [] } = raw;
    const tileset = raw.tileset ?? 1;
    ensure([1,4].includes(tileset) && floor === 384, `Map ${key}: the browser skin supports tilesets 1 and 4 with floor tile 384`);
    ensure(Number.isInteger(width) && Number.isInteger(height) && width >= 20 && height >= 15 && width <= 50 && height <= 50,
      `Map ${key}: web map dimensions must be between 20×15 and 50×50`);
    const grids = Array.from({ length:3 },(_, z)=>Array(width * height).fill(z === 0 ? floor : 0));
    for (const layer of raw.layers ?? []) {
      ensure(grids[layer.z] && layer.rows.length === height, `Map ${key}: invalid layer ${layer.z}`);
      layer.rows.forEach((row,y) => {
        ensure(Array.from(row).length === width, `Map ${key}: invalid layer row ${y}`);
        Array.from(row).forEach((character,x)=>{
          if (character === '.') return;
          ensure(Number.isInteger(legend[character]), `Map ${key}: unknown tile symbol '${character}'`);
          grids[layer.z][y * width + x] = legend[character];
        });
      });
    }
    const terrain = [], blocked = [], scenery = [];
    const sand = tileset === 4 ? 144 : 192;
    const anchors = tileset === 4 ? {520:'pine',584:'rocks'} : {424:'tree',488:'tent'};
    for (let i = 0; i < width * height; i++) {
      const tiles = grids.map(grid=>grid[i]);
      const water = tiles.some(tile => tile >= 48 && tile < 96);
      terrain.push(water ? 'water' : tiles.some(tile => tile >= sand && tile < sand + 48) ? 'path' : 'grass');
      let solid = water;
      for (const tile of tiles.slice(1).filter(Boolean)) {
        if (tileset === 1) solid ||= [388,390,391,396,398,399,456,457,458,501,502,503,504,505,506,507,508,512,513,514,515,516,520,521,522,523,524].includes(tile);
        if (tileset === 4) solid ||= [389,390,391,395,413,414,415,545,546,547,584,585,586,592,593,594,600,601,602].includes(tile);
        const kind = anchors[tile] ?? ({392:'shrub',394:'flower',398:'shrub',390:'flower',389:'pebbles',405:'pebbles'})[tile];
        if (kind) scenery.push({kind,x:i % width,y:Math.floor(i / width)});
      }
      blocked.push(solid);
    }
    for (const event of events) {
      position({ map:key, x:event.x, y:event.y });
      for (const page of event.pages) {
        ensure(!page.trigger || ['action','touch','event_touch'].includes(page.trigger), `Map ${key}: unsupported web event trigger '${page.trigger}'`);
        validateSteps(page.commands);
      }
    }
    return {key,name:raw.name,width,height,tileset,terrain,blocked,scenery,events};
  })};
}

export async function exportWeb(spec, target) {
  const data = compileWeb(spec);
  const destination = resolve(target);
  await mkdir(dirname(destination), {recursive:true});
  const parent = await realpath(dirname(destination));
  const stage = await mkdtemp(join(parent,'.web-export-'));
  ensure(dirname(await realpath(stage)) === parent, 'Unexpected web staging path');
  try {
    await cp(views, stage, {recursive:true});
    await writeFile(join(stage,'game-data.js'), `globalThis.LIGHTHOUSE_DATA = ${JSON.stringify(data)};\n`, 'utf8');
    const out = join(parent,basename(destination));
    await rename(stage,out);
    return {directory:out, launch:join(out,'index.html'), maps:data.maps.length};
  } finally {
    await rm(stage,{recursive:true,force:true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , source, target] = process.argv;
  try {
    ensure(source && target,'Usage: node studio/web-export.mjs <spec.json> <new output directory>');
    const spec=JSON.parse((await readFile(source,'utf8')).replace(/^\uFEFF/,''));
    console.log(JSON.stringify(await exportWeb(spec,target),null,2));
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
