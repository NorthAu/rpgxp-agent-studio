(() => {
  const size = 32;
  function createWorld(canvas) {
    const ctx = canvas.getContext('2d');
    let background, mapKey;
    const rect = (g, color, x, y, w, h) => {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    };
    const polygon = (g, color, points) => {
      g.fillStyle = color;
      g.beginPath();
      points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
      g.closePath();
      g.fill();
    };

    function ground(g, map, c, r) {
      const i = r * map.width + c;
      const seed = Math.imul((r + 63) * 23, (c + 39) * 11) >>> 0;
      const w = 32, x = c * w, y = r * w;
      const water = map.terrain[i] === 'water';
      const path = map.terrain[i] === 'path';
      const colors = water ? ['#24565b','#26585e','#285d61'] :
        path ? ['#ad8e59','#b0935e','#ae905e'] :
        map.tileset === 4 ? ['#4c684d','#526b50','#4d654e'] : ['#546f4b','#56734c','#57714e'];
      rect(g, colors[seed % 3], x, y, w, w);
      for (let j = 0; j < 6; j++) {
        const pos = Math.imul(seed + j * 991, 2654435761) >>> 0;
        const ink = water ? (j < 2 ? '#448285' : '#2f686c') : path ? '#c8a775' : (j < 3 ? '#67815a' : '#405c44');
        rect(g, ink, x + pos % 25, y + ((pos >>> 8) % 29), water ? 5 + pos % 3 : 2 + pos % 2, water ? 1 : 2);
      }
      if (water) {
        const isLand = (mx, my) => mx >= 0 && my >= 0 && mx < map.width && my < map.height &&
          map.terrain[my * map.width + mx] !== 'water';
        if (isLand(c + 1, r)) {rect(g,'#44756b',x+26,y,6,32);rect(g,'#89a484',x+30,y,2,32);}
        if (isLand(c - 1, r)) {rect(g,'#44756b',x,y,6,32);rect(g,'#89a484',x,y,2,32);}
        if (isLand(c, r + 1)) {rect(g,'#44756b',x,y+26,32,6);rect(g,'#89a484',x,y+30,32,2);}
        if (isLand(c, r - 1)) {rect(g,'#44756b',x,y,32,6);rect(g,'#89a484',x,y,32,2);}
      }
    }

    function scenery(g, kind, x, y) {
      if (kind === 'tent') {
        polygon(g,'#2d4337',[[x+8,y+130],[x+139,y+130],[x+153,y+145],[x+18,y+151]]);
        polygon(g,'#d5a776',[[x+5,y+131],[x+74,y+19],[x+149,y+130]]);
        polygon(g,'#a45d49',[[x+74,y+19],[x+149,y+130],[x+74,y+130]]);
        polygon(g,'#ecc68b',[[x+5,y+131],[x+74,y+19],[x+59,y+123]]);
        rect(g,'#302d29',x+61,y+105,25,32);rect(g,'#e7b57c',x+57,y+100,33,7);
        rect(g,'#e4ba7a',x+72,y+18,4,10);
      } else if (kind === 'pine' || kind === 'tree') {
        const pine = kind === 'pine', width = pine ? 103 : 111, foot = pine ? 114 : 142;
        rect(g,'#3c553e',x+18,y+foot-4,width-19,10);
        rect(g,'#70573c',x+47,y+foot-25,16,28);rect(g,'#a68258',x+48,y+foot-22,4,22);
        for (let tier = 0; tier < 3; tier++) {
          const base = y + 60 + tier * 19;
          const spread = 27 + 12 * tier;
          if (pine) {
            polygon(g,['#3d6253','#345848','#2c4d41'][tier],[[x+55,base-54],[x+55-spread,base+11],[x+55+spread,base+11]]);
            polygon(g,'#527663',[[x+55,base-54],[x+55-spread,base+11],[x+50,base+5]]);
          } else {
            polygon(g,['#7b8d58','#65794a','#566c43'][tier],[[x+55,base-57],[x+55-spread,base-24],[x+50-spread,base+6],[x+65+spread,base+6],[x+63+spread,base-17]]);
            rect(g,'#839661',x+45-tier*6,base-26,8,3);
          }
        }
      } else if (kind === 'rocks') {
        rect(g,'#3a4a40',x+7,y+66,70,10);
        for (const [dx,dy,w] of [[9,37,27],[31,21,32],[55,40,25],[33,44,30],[15,54,18]]) {
          polygon(g,'#66746b',[[x+dx,y+dy+w],[x+dx+3,y+dy+5],[x+dx+w-8,y+dy],[x+dx+w,y+dy+w-2]]);
          rect(g,'#9ca295',x+dx+5,y+dy+6,w-13,3);
        }
      } else if (kind === 'flower' || kind === 'shrub' || kind === 'pebbles') {
        const bloom = kind === 'flower' ? '#eac582' : kind === 'shrub' ? '#77935d' : '#989781';
        rect(g,'#3b5740',x+8,y+21,18,5);
        rect(g,bloom,x+10,y+15,5,5);rect(g,bloom,x+17,y+12,6,6);rect(g,bloom,x+22,y+19,4,4);
      }
    }

    function drawBackground(map) {
      mapKey = map.key;
      background = document.createElement('canvas');
      background.width = canvas.width = map.width * size;
      background.height = canvas.height = map.height * size;
      const g = background.getContext('2d');
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) ground(g,map,x,y);
      for (const prop of map.scenery) scenery(g,prop.kind,prop.x * size,prop.y * size);
    }

    function person(g, x, y, hero, direction = 2) {
      rect(g,'#263932',x+4,y+24,23,6);
      rect(g,'#182b2b',x+9,y+17,14,13);
      rect(g,hero?'#ca905d':'#6d7c91',x+7,y+14,18,9);
      rect(g,hero?'#f3ca86':'#b3bbc0',x+9,y+4,14,9);
      rect(g,'#dba57d',x+10,y+10,12,7);
      rect(g,hero?'#ca905d':'#6d7c91',x+6,y+5,19,4);
      if (direction !== 8) rect(g,'#352b2a',x+(direction===4?10:19),y+12,2,2);
      else rect(g,hero?'#966849':'#616e78',x+10,y+10,12,6);
    }

    function drawEvent(event,page,amount) {
      const x=event.x*size, y=event.y*size;
      const sprite=page.sprite;
      if (/Door/i.test(sprite)) {
        rect(ctx,'#3a342a',x+1,y-5,30,38);
        rect(ctx,'#9e7851',x+4,y-8,24,38);
        rect(ctx,'#4d6c62',x+7,y-2,18,13);
        rect(ctx,'#d5b681',x+15,y-2,2,13);
        rect(ctx,'#d5b681',x+7,y+4,18,2);
        rect(ctx,'#dbb677',x+20,y+18,3,3);
      } else if (/Chest/i.test(sprite)) {
        rect(ctx,'#513b2d',x+1,y+14,30,16);
        rect(ctx,'#96633e',x+3,y+11,26,14);
        rect(ctx,'#caa267',x+3,y+13,26,3);
        rect(ctx,'#e7c674',x+13,y+18,6,6);
      } else if (/Switch|Light/i.test(sprite)) {
        const lit = /Light/i.test(sprite);
        polygon(ctx,'#c0ad83',[[x+2,y+31],[x+7,y-21],[x+23,y-21],[x+29,y+31]]);
        rect(ctx,'#425c53',x+8,y-32,15,15);
        rect(ctx,lit?'#fff0a8':'#778d7d',x+11,y-30,9,11);
        polygon(ctx,'#324940',[[x+5,y-32],[x+15,y-41],[x+26,y-32]]);
        rect(ctx,'#6d5442',x+12,y+14,8,16);
        if(lit) {
          ctx.save();
          ctx.globalAlpha = 0.33 + Math.sin(amount / 430) * 0.06;
          polygon(ctx,'#ffe391',[[x+17,y-25],[0,y-74],[0,y+17]]);
          ctx.restore();
        }
      } else person(ctx,x,y,false,page.direction);
    }

    function render(game, time) {
      const map=game.map(), {player,switches}=game.state;
      if (mapKey !== map.key) drawBackground(map);
      ctx.drawImage(background,0,0);
      const actors = map.events.flatMap(event => {
        const page=event.pages.findLast(page=>!page.switch||switches.has(page.switch));
        return page?.sprite ? [{y:event.y, draw:()=>drawEvent(event,page,time)}] : [];
      });
      actors.push({y:player.y,draw:()=>person(ctx,player.x*size,player.y*size,true,player.direction)});
      actors.sort((a,b)=>a.y-b.y).forEach(actor=>actor.draw());
    }
    return render;
  }
  globalThis.createLighthouseWorld = createWorld;
})();
