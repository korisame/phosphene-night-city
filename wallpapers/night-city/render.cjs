const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const supportedFlags=new Set(['--verify-source','--verify-character','--verify-billboards','--verify-lighting','--verify-portrait-rig','--verify-screens','--draft','--verify-weather','--verify-cloth','--verify-city-life','--benchmark']);
const chunkArg=process.argv.slice(2).find(v=>/^--chunk=[01]$/.test(v));
for(const flag of process.argv.slice(2))if(!supportedFlags.has(flag)&&flag!==chunkArg)throw Error('Unknown renderer option: '+flag);
const chunkIndex=chunkArg?Number(chunkArg.split('=')[1]):null;
const scene = require('./scene.json');
const W = scene.width, H = scene.height, FPS = scene.fps, D = scene.durationSeconds, N = D * FPS, TAU = 2 * Math.PI;
const ambientCycles = D / scene.ambientMotionPeriodSeconds;
if (!Number.isInteger(ambientCycles)) throw Error('Ambient cycles must close at the loop boundary');
const AW = 1672, AH = 941, SX = W / AW, SY = H / AH;
const output = name => path.join(__dirname, name);
let seed = 43653;
const rnd = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
const mod = (x, m) => (x % m + m) % m;
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const rain = Array.from({ length: 600 }, () => ({ x: rnd() * W, y: rnd() * H, len: 16 + rnd() * 65, alpha: .08 + rnd() * .22, width: .7 + rnd() * 1.6, laps: 5 + Math.floor(rnd() * 7) }));
const ripples = Array.from({ length: 40 }, () => ({ x: rnd() * W, y: H * (.916 + rnd() * .08), phase: rnd(), r: 15 + rnd() * 45 }));
const mist = Array.from({ length: 26 }, () => ({ x: W * (.28 + rnd() * .64), y: H * (.40 + rnd() * .21), r: 60 + rnd() * 150, phase: rnd() * TAU }));
const craft = Array.from({ length: 6 }, (_, i) => ({ x: rnd(), y: .30 + rnd() * .18, size: 1.8 + rnd() * 2, phase: rnd() * TAU, laps: 2+i%2, dir: i % 2 ? 1 : -1 }));
const canvas = createCanvas(W, H), ctx = canvas.getContext('2d');
const details = require('./details.cjs')(ctx, {W,H,AW,AH,D});
const naturalLights = require('./natural-lights.cjs')(ctx,{W,H,AW,AH,D,createCanvas,glow,scene});
const SKYLINE = [[0,0],[824,0],[824,100],[798,82],[784,135],[767,148],[736,152],[736,188],[710,189],[710,257],[675,252],[675,289],[651,285],[651,308],[626,306],[626,324],[595,318],[595,357],[561,362],[561,392],[532,406],[513,449],[457,451],[442,431],[438,450],[419,489],[400,470],[389,494],[366,477],[332,508],[317,492],[283,511],[255,495],[239,510],[221,486],[196,506],[172,486],[144,497],[122,469],[103,487],[101,460],[72,450],[48,456],[28,489],[0,494]];
const weather=require('./weather.cjs')(ctx,{W,H,AW,AH,D,scene,polygon,skyline:SKYLINE});
const cityLife=require('./city-life.cjs')(ctx,{W,H,AW,AH,D,scene,polygon,skyline:SKYLINE,glow});
const blueDistrict=require('./blue-district.cjs')(ctx,{W,H,AW,AH,D,scene});
const oledLut=Uint8Array.from({length:256},(_,v)=>Math.round(255*Math.pow(Math.max(0,v-8)/247,1.20)));
let nightSky,nightBase;
function prepareNightSky() {
  nightBase=createCanvas(W,H);const c=nightBase.getContext('2d');c.drawImage(nightSky,0,0,W,H);
  // The registered detailed plate shares the approved geometry; emitter and occlusion textures use this same plate.
}
const oledTransfer=require('./oled-transfer.cjs');
function applyOLEDGrade(){
  const frame=ctx.getImageData(0,0,W,H);oledTransfer.apply(frame.data);ctx.putImageData(frame,0,0);
}

const crop = JSON.parse(fs.readFileSync(output('sprite-crop.json'), 'utf8'));
const sprite = createCanvas(crop.width, crop.height), spriteCtx = sprite.getContext('2d');
const actorHeight = H * .3975, actorWidth = actorHeight * crop.width / crop.height;
const actor = { x: W * (.7507 + .0836 / 2) - actorWidth / 2, y: H * .4931, width: actorWidth, height: actorHeight };
const posePadding = 24, pose = createCanvas(crop.width + posePadding * 2, crop.height + posePadding * 2), poseCtx = pose.getContext('2d');
let characterLayers,collarBeads=[];
let silverTrimCyan,silverTrimPink;
const sceneEmission={};
let art, portrait, blinkPatch, portraitFrame, portraitRig, cyanCore, cyanBloom, magentaCore, floorCyan, floorMagenta, windowLights = [];
const measureScreenEmission=require('./screen-emission.cjs');
let midAd, midAdFrame, midEyePatches;

// Coordinates follow the existing screen surfaces; architecture never moves.
const screens = [
  { name: 'portrait', type: 'portrait', phase: 0, quad: [[1460, 374], [1526, 375], [1532, 569], [1464, 568]],
    occlusion: [[1491,512],[1495,512],[1495,533],[1497,533],[1497,524],[1500,522],[1524,519],[1525,516],[1528,516],[1529,522],[1534,522],[1534,571],[1485,571],[1485,548],[1489,548],[1489,533],[1491,533]] },
  { name: 'mid', type: 'hero-ad', phase: 1.9, quad: [[883,286],[923,282],[923,399],[883,405]],
    occlusion: [[895,357],[902,357],[902,376],[907,380],[923,382],[923,402],[895,404],[895,385],[891,383],[891,378],[895,377]] },
  { name: 'left', type: 'original', phase: 4.1, quad: [[799,448],[834,445],[836,562],[798,564]],
    occlusion: [[805,556],[810,553],[818,553],[822,558],[836,558],[836,566],[798,566],[798,561],[805,561]] },
  { name: 'upper', type: 'original', phase: 3, quad: [[1386,154],[1418,148],[1418,224],[1386,232]],
    occlusion: [[1400,209],[1404,209],[1404,219],[1410,218],[1418,218],[1418,229],[1386,233],[1386,226],[1394,223],[1400,222]] },
  { name: 'small', type: 'original', phase: 5.2, quad: [[1362,322],[1380,318],[1382,358],[1364,359]] },
  { name: 'cyan', type: 'data', phase: 2.2, quad: [[690,379],[698,377],[697,431],[688,434]] }
];

function polygon(c, points, scaleX = 1, scaleY = 1) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x * scaleX, y * scaleY) : c.moveTo(x * scaleX, y * scaleY)); c.closePath();
}
function glow(c, x, y, rx, ry, color, alpha) {
  c.save(); c.translate(x, y); c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${color},${alpha})`); g.addColorStop(.35, `rgba(${color},${alpha * .48})`); g.addColorStop(1, `rgba(${color},0)`);
  c.fillStyle = g; c.fillRect(-rx, -rx, rx * 2, rx * 2); c.restore();
}
const ease5 = x => { x = Math.max(0, Math.min(1, x)); return x * x * x * (10 + x * (-15 + x * 6)); };
function prepareCharacter() {
  const source = spriteCtx.getImageData(0, 0, sprite.width, sprite.height);
  characterLayers = Array.from({ length: 4 }, () => createCanvas(sprite.width, sprite.height));
  const contexts = characterLayers.map(layer => layer.getContext('2d'));
  const images = contexts.map(c => c.createImageData(sprite.width, sprite.height));
  for (let y = 0; y < sprite.height; y++) {
    const u = y / sprite.height;
    // The hair and skull belong to one rigid head. Blend only at the neck and hips.
    const head = 1 - ease5((u - .105) / .05);
    const body = (1 - head) * (1 - ease5((u - .46) / .20));
    for (let x = 0; x < sprite.width; x++) {
      const i = (y * sprite.width + x) * 4, alpha = source.data[i + 3];
      const a = Math.round(alpha * head), b = Math.min(alpha - a, Math.round(alpha * body));
      // Isolate only the lower yellow hem with a feathered upper seam.
      const hem=ease5((u-.440)/.020)*(1-ease5((u-.494)/.009))*ease5((x/sprite.width-.13)/.06)*(1-ease5((x/sprite.width-.82)/.055));
      const h=Math.min(alpha-a,Math.round(alpha*hem));
      const bodyAlpha=Math.min(alpha-a-h,b);
      const weights = [a, bodyAlpha, alpha-a-bodyAlpha-h,h];
      for (let k = 0; k < 4; k++) {
        for (let c = 0; c < 3; c++) images[k].data[i + c] = source.data[i + c];
        images[k].data[i + 3] = weights[k];
      }
    }
  }
  contexts.forEach((c, i) => c.putImageData(images[i], 0, 0));
  // Beads stay on source yellow fabric, away from the collar lettering and skin.
  for(const [x,y] of [[175,220],[195,211],[222,208],[331,214],[359,223],[392,245],[104,288],[128,283],[373,279],[407,295],[141,300],[349,267]]) {
    const i=(y*sprite.width+x)*4;
    if(source.data[i+3]>240 && source.data[i]>150 && source.data[i+1]>100 && source.data[i+2]<150)collarBeads.push({x,y,phase:collarBeads.length*.618});
  }
  silverTrimCyan=createCanvas(sprite.width,sprite.height);silverTrimPink=createCanvas(sprite.width,sprite.height);
  for(const [layer,color,left]of [[silverTrimCyan,[104,223,255],true],[silverTrimPink,[255,110,213],false]]) {
    const c=layer.getContext('2d'),m=c.createImageData(sprite.width,sprite.height);
    for(let y=Math.floor(sprite.height*.235);y<sprite.height*.42;y++)for(let x=0;x<sprite.width;x++) {
      const at=(y*sprite.width+x)*4,r=source.data[at],g=source.data[at+1],b=source.data[at+2];
      if(source.data[at+3]<240||Math.min(r,g,b)<80||Math.max(r,g,b)-Math.min(r,g,b)>55)continue;
      const weight=left?Math.pow(1-x/sprite.width,1.7):Math.pow(x/sprite.width,1.7);
      m.data[at]=color[0];m.data[at+1]=color[1];m.data[at+2]=color[2];m.data[at+3]=Math.round(weight*48);
    }
    c.putImageData(m,0,0);
  }
}
function characterMotion(seconds,{glancing=true}={}) {
  const t = mod(seconds, D), breaths = scene.breathBoundaries, lifts = scene.breathLiftsPixels;
  const cycle = Math.min(lifts.length - 1, breaths.findIndex((boundary, i) => i > 0 && t < boundary) - 1);
  const u = (t - breaths[cycle]) / (breaths[cycle + 1] - breaths[cycle]);
  // Inhale, longer exhale, then a short quiet rest. All joins have zero velocity and acceleration.
  const breath = u < .34 ? ease5(u / .34) : 1 - ease5((u - .34) / .58);
  const settled = scene.postureEvents.reduce((sum, event) => {
    const age = t - event.start;
    if (age < 0 || age >= event.rise + event.hold + event.fall) return sum;
    const weight = age < event.rise ? ease5(age / event.rise)
      : age < event.rise + event.hold ? 1 : 1 - ease5((age - event.rise - event.hold) / event.fall);
    return sum + event.gain * weight;
  }, 0);
  return { lift: lifts[cycle] * breath, torso: .22 * Math.PI / 180 * settled, head: (-.55 * settled+(glancing?cityLife.glance(t):0)) * Math.PI / 180 };
}
function drawDavid(p,{poseOnly=false,weatherOverride=null,clothingWet=true,glancing=true}={}) {
  const motion = characterMotion(p / TAU * D,{glancing}), scale = actor.height / sprite.height;
  const hip = { x: sprite.width * .5, y: sprite.height * .505 };
  const neck = { x: sprite.width * .46, y: sprite.height * .129 };
  poseCtx.setTransform(1, 0, 0, 1, 0, 0); poseCtx.clearRect(0, 0, pose.width, pose.height);
  // Add premultiplied layers on transparency, then composite once onto the city.
  // This avoids doubled opacity and strip seams through the jacket and silhouette.
  poseCtx.globalCompositeOperation = 'lighter';
  poseCtx.save(); poseCtx.translate(posePadding, posePadding);
  poseCtx.drawImage(characterLayers[2], 0, 0);
  poseCtx.translate(hip.x, hip.y - motion.lift / scale); poseCtx.rotate(motion.torso); poseCtx.translate(-hip.x, -hip.y);
  poseCtx.drawImage(characterLayers[1], 0, 0);
  const weatherState=weatherOverride??weather.state(p/TAU*D);
  poseCtx.save();
  const hemPivot={x:sprite.width*.49,y:sprite.height*.449};
  poseCtx.translate(hemPivot.x,hemPivot.y);
  // Local cloth gives to the gust, then settles. Torso, shoulders and feet retain their rig.
  poseCtx.rotate((.35*weatherState.gust*Math.sin(p*29)+.10*weatherState.wind)*Math.PI/180);
  poseCtx.translate(-hemPivot.x,-hemPivot.y);poseCtx.drawImage(characterLayers[3],0,0);poseCtx.restore();
  poseCtx.save();poseCtx.globalCompositeOperation='source-over';
  for(const b of clothingWet?collarBeads:[]) {
    const u=mod(p/TAU*7+b.phase,1),a=Math.sin(Math.PI*u)**2*(.26+.09*weatherState.rain);
    const y=b.y+u*4;
    poseCtx.fillStyle=`rgba(48,100,111,${a*.60})`;poseCtx.beginPath();poseCtx.ellipse(b.x,y,1.8,2.5,0,0,TAU);poseCtx.fill();
    poseCtx.fillStyle=`rgba(176,243,255,${a})`;poseCtx.beginPath();poseCtx.ellipse(b.x-.5,y-.7,.75,1.25,0,0,TAU);poseCtx.fill();
  }
  poseCtx.restore();
  // Source-aligned reflective silver trim catches the adjacent neon gently.
  // It follows the same rigid torso transform and does not reshape the jacket.
  poseCtx.save();poseCtx.globalCompositeOperation='screen';
  poseCtx.globalAlpha=.24+.01*Math.sin(p*2);poseCtx.drawImage(silverTrimCyan,0,0);
  poseCtx.globalAlpha=.21+.075*(sceneEmission.portrait??.3);poseCtx.drawImage(silverTrimPink,0,0);poseCtx.restore();
  poseCtx.translate(neck.x, neck.y); poseCtx.rotate(motion.head); poseCtx.translate(-neck.x, -neck.y);
  poseCtx.drawImage(characterLayers[0], 0, 0); poseCtx.restore();
  if(poseOnly)return;
  details.drawCharacterGround(p * ambientCycles, pose, actor, posePadding, scale);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.drawImage(pose, actor.x - posePadding * scale, actor.y - posePadding * scale, pose.width * scale, pose.height * scale);
}

function pointInQuad(x, y, q) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i], b = q[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function prepareLightMasks() {
  const source = createCanvas(AW, AH), sc = source.getContext('2d'); sc.drawImage(nightBase, 0, 0, AW, AH);
  const pixels = sc.getImageData(0, 0, AW, AH).data;
  const blue = createCanvas(AW, AH), bc = blue.getContext('2d'), bi = bc.createImageData(AW, AH);
  const pink = createCanvas(AW, AH), pc = pink.getContext('2d'), pi = pc.createImageData(AW, AH);
  floorCyan = createCanvas(AW, AH); const fc = floorCyan.getContext('2d'), fi = fc.createImageData(AW, AH);
  floorMagenta = createCanvas(AW, AH); const fm = floorMagenta.getContext('2d'), mi = fm.createImageData(AW, AH);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const i = (y * AW + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const isBlue = b > 130 && g > 105 && r < g * .78;
    const isPink = r > 105 && b > 100 && g < Math.min(r, b) * .72;
    if (isBlue || isPink) {
      const target = isBlue ? bi.data : pi.data;
      target[i] = isBlue ? 145 : 246; target[i + 1] = isBlue ? 225 : 107; target[i + 2] = isBlue ? 255 : 216;
      target[i + 3] = Math.min(185, Math.max(r, g, b) - 80);
      if (y > 812) {
        const floor = isBlue ? fi.data : mi.data;
        floor[i] = target[i]; floor[i + 1] = target[i + 1]; floor[i + 2] = target[i + 2]; floor[i + 3] = target[i + 3];
      }
    }
  }
  bc.putImageData(bi, 0, 0); pc.putImageData(pi, 0, 0); fc.putImageData(fi, 0, 0); fm.putImageData(mi, 0, 0);
  cyanCore = blue; magentaCore = pink;
  cyanBloom = createCanvas(AW, AH); const cb = cyanBloom.getContext('2d'); cb.filter = 'blur(7px)'; cb.drawImage(blue, 0, 0);
  const fullSource=createCanvas(W,H);fullSource.getContext('2d').drawImage(nightBase,0,0,W,H);
  windowLights=require('./emitter-masks.cjs')(fullSource,{AW,AH,createCanvas,pointInQuad,screens});
  naturalLights.prepare(fullSource,windowLights,pointInQuad,screens);
  fs.writeFileSync(output('light-map.json'),JSON.stringify({detectedApartmentWindows:windowLights.length,
    independentlyChangingWindows:windowLights.filter(w=>['occupancy','interior'].includes(w.mode)).length,
    screens:screens.map(({name,type,quad})=>({name,type,quad})),warmWindowsDerivedFromArtwork:true,emitterMaskResolution:[W,H],
    naturalLighting:naturalLights.manifest(),blueTowerIntensityVariation:'steady architectural source with drifting atmospheric scattering',
    reflectionsFollowLightSources:true},null,2));
}

function prepareScreens() {
  const source = createCanvas(W,H), sourceCtx = source.getContext('2d');sourceCtx.drawImage(nightBase,0,0,W,H);
  const pixels = sourceCtx.getImageData(0,0,W,H).data;
  for (const s of screens) {
    s.panel = createCanvas(256, 768); s.c = s.panel.getContext('2d');
    const xs = s.quad.map(q => q[0]), ys = s.quad.map(q => q[1]);
    s.bounds = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    s.texture = createCanvas(256, 768); const tc = s.texture.getContext('2d'), ti = tc.createImageData(256, 768);
    const [a,b,c,d] = s.quad;
    // Rectify the already-perspective artwork before animating and projecting it back.
    for (let y = 0; y < 768; y++) for (let x = 0; x < 256; x++) {
      const u = x / 255, v = y / 767;
      const px = (a[0] * (1-u) + b[0] * u) * (1-v) + (d[0] * (1-u) + c[0] * u) * v;
      const py = (a[1] * (1-u) + b[1] * u) * (1-v) + (d[1] * (1-u) + c[1] * u) * v;
      const rx=(px+.5)*SX-.5,ry=(py+.5)*SY-.5;
      const ix=Math.floor(rx),iy=Math.floor(ry),fx=rx-ix,fy=ry-iy,at=(y*256+x)*4;
      for (let channel = 0; channel < 3; channel++) {
        ti.data[at + channel] = pixels[(iy * W + ix) * 4 + channel] * (1-fx) * (1-fy) + pixels[(iy * W + ix+1) * 4 + channel] * fx * (1-fy) + pixels[((iy+1) * W + ix) * 4 + channel] * (1-fx) * fy + pixels[((iy+1) * W + ix+1) * 4 + channel] * fx * fy;
      }
      ti.data[at + 3] = s.occlusion && pointInQuad(px, py, s.occlusion) ? 0 : 255;
    }
    tc.putImageData(ti, 0, 0);
    if(process.argv.includes('--verify-screens'))fs.writeFileSync(output(`qa/source-screen-${s.name}.png`),s.texture.toBuffer('image/png'));
  }
}
function prepareBlink(blink) {
  const region = {x: 340, y: 275, w: 108, h: 69};
  const patch = createCanvas(region.w, region.h), pc = patch.getContext('2d'); pc.drawImage(blink, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
  const pixels = pc.getImageData(0, 0, region.w, region.h);
  for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) { const at = (y * region.w + x) * 4 + 3; pixels.data[at] = (pixels.data[at] > 230 ? 255 : pixels.data[at]) * smooth(Math.min(x, y, region.w - 1 - x, region.h - 1 - y) / 8); }
  pc.putImageData(pixels, 0, 0); blinkPatch = patch;
  portraitFrame = createCanvas(portrait.width, portrait.height);
}
function billboardPortrait(p) {
  const t = p / TAU * D; let blink = 0;
  for (const when of scene.portraitBlinkTimes) {
    const age = t - when;
    if (age >= 0 && age < .26) blink = Math.max(blink, age < .08 ? smooth(age / .08) : age < .14 ? 1 : 1 - smooth((age - .14) / .12));
  }
  if (blink === 0) return portrait;
  const c = portraitFrame.getContext('2d'); c.clearRect(0, 0, portrait.width, portrait.height); c.globalAlpha = 1; c.drawImage(portrait, 0, 0); c.globalAlpha = blink; c.drawImage(blinkPatch, 340, 275); c.globalAlpha = 1;
  return portraitFrame;
}
function portraitBlinkAmount(t){
  let blink=0;
  for(const when of scene.portraitBlinkTimes){const age=t-when;if(age>=0&&age<.26)blink=Math.max(blink,age<.08?smooth(age/.08):age<.14?1:1-smooth((age-.14)/.12));}
  return blink;
}
function prepareMidBlink(image) {
  const regions=[{x:335,y:352,w:123,h:89},{x:478,y:408,w:87,h:81}];
  midEyePatches=regions.map(r=>{
    const layer=createCanvas(r.w,r.h),c=layer.getContext('2d');c.drawImage(image,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
    const data=c.getImageData(0,0,r.w,r.h);
    for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++)data.data[(y*r.w+x)*4+3]*=smooth(Math.min(x,y,r.w-1-x,r.h-1-y)/11);
    c.putImageData(data,0,0);return {...r,layer};
  });
  midAdFrame=createCanvas(midAd.width,midAd.height);
}
function billboardMid(p) {
  const t=p/TAU*D;let blink=0;
  for(const when of scene.centralBlinkTimes) {
    const age=t-when;
    if(age>=0&&age<.27)blink=Math.max(blink,age<.075?smooth(age/.075):age<.135?1:1-smooth((age-.135)/.135));
  }
  if(!blink)return midAd;
  const c=midAdFrame.getContext('2d');c.clearRect(0,0,midAd.width,midAd.height);c.globalAlpha=1;c.drawImage(midAd,0,0);c.globalAlpha=blink;
  for(const patch of midEyePatches)c.drawImage(patch.layer,patch.x,patch.y);
  c.globalAlpha=1;return midAdFrame;
}
function drawScreenContent(s, p) {
  const fullPhase = p;
  const fullTime = fullPhase / TAU * D;
  p *= ambientCycles;
  const c = s.c, width = s.panel.width, height = s.panel.height, f = p + s.phase;
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  const bg = c.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, s.type === 'data' ? '#176aa5' : '#7920bb'); bg.addColorStop(.5, s.type === 'data' ? '#26c3e7' : '#eb28bd'); bg.addColorStop(1, s.type === 'data' ? '#1d5692' : '#9d19b8');
  c.fillStyle = bg; c.fillRect(0, 0, width, height);
  if (s.type === 'portrait') {
    // Electronic ad background: moving diagrams, no world/camera transform.
    c.strokeStyle = '#ffc4f0'; c.globalAlpha = .18; c.lineWidth = 1.1;
    for (let i = 0; i < 6; i++) {
      const y = mod(i * 128 + p / TAU * height, height);
      for (const yy of [y, y-height]) { c.beginPath(); c.moveTo(0, yy); c.lineTo(width * .55, yy); c.lineTo(width * .65, yy + 20); c.lineTo(width, yy + 20); c.stroke(); }
    }
    c.save(); c.translate(width * .52, 170); c.rotate(p * 2); c.beginPath(); c.arc(0, 0, 82, .25, Math.PI * 1.4); c.stroke(); c.restore();
    c.globalAlpha = 1;
    const portraitImage = portraitRig.pose(fullTime,portraitBlinkAmount(fullTime));
    const heightP = 696, widthP = heightP * portrait.width / portrait.height, baseX = -78, baseY = 69;
    const scale=heightP/portrait.height;
    c.drawImage(portraitImage,baseX-portraitRig.padding*scale,baseY-portraitRig.padding*scale,portraitImage.width*scale,portraitImage.height*scale);
  } else if (s.type === 'hero-ad') {
    c.drawImage(billboardMid(fullPhase),0,0,width,height);
    c.globalAlpha=.16;c.strokeStyle='#ffd4fa';c.lineWidth=1.1;
    for(let i=0;i<7;i++) {
      const y=mod(i*122-p/TAU*height*2,height);
      for(const yy of [y,y-height]) {c.beginPath();c.moveTo(7,yy);c.lineTo(19,yy);c.lineTo(19,yy+26);c.lineTo(8,yy+35);c.stroke();c.beginPath();c.moveTo(width-7,yy+18);c.lineTo(width-20,yy+18);c.lineTo(width-20,yy+41);c.stroke();}
    }
    c.globalAlpha=1;
  } else if (s.type === 'original') {
    // LED poster illustrations remain rigid. Only designed border graphics move;
    // bending an entire poster through horizontal strips made bodies stretch.
    c.drawImage(s.texture,0,0,width,height);
    if(s.name==='upper') {
      const mix=weather.adMix(fullTime);
      if(mix>0){
        c.save();c.globalAlpha=mix;c.fillStyle='#09182c';c.fillRect(0,0,width,height);
        c.strokeStyle='#66dcf7';c.lineWidth=3;
        // One slow editorial swap to an abstract circuit advert, entirely inside the display.
        for(let ring=0;ring<4;ring++){const r=32+ring*17;c.beginPath();c.ellipse(width/2,height*.39,r,r*1.4,0,.15+ring*.4,5.2+ring*.4);c.stroke();}
        c.strokeStyle='#f17cc9';c.lineWidth=2;c.beginPath();c.moveTo(width*.5,height*.23);c.lineTo(width*.77,height*.44);c.lineTo(width*.23,height*.44);c.closePath();c.stroke();
        for(let i=0;i<10;i++){c.fillStyle=i%3?'#7bd9ea':'#f484d5';c.fillRect(26,height*.64+i*16,35+(i*47%160),4);}
        c.restore();
      }
    }
    c.globalCompositeOperation='screen';c.globalAlpha=.22;c.strokeStyle='#ffd4fa';c.lineWidth=1.2;
    for(let i=0;i<4;i++){
      const y=mod(i*220-p/TAU*height+s.phase*35,height);
      for(const yy of [y,y-height])for(const side of [0,1]){
        const x=side?width-7:7,dir=side?-1:1;
        c.beginPath();c.moveTo(x,yy);c.lineTo(x+dir*9,yy);c.lineTo(x+dir*9,yy+18);c.lineTo(x,yy+26);c.stroke();
      }
    }
    c.globalAlpha=1;c.globalCompositeOperation='source-over';
  } else {
    c.strokeStyle = '#c8fbff'; c.lineWidth = 4;
    for (let i = 0; i < 6; i++) { const y = mod(i * 128 - p / TAU * height, height); for (const yy of [y,y-height]) { c.beginPath(); c.moveTo(40, yy + 32); c.lineTo(128, yy); c.lineTo(218, yy + 32); c.stroke(); } }
  }
  // Fine LED rows and a rolling refresh band stay clipped to each display.
  c.globalCompositeOperation = 'screen'; c.globalAlpha = .11; c.fillStyle = '#fff0ff';
  for (let i = 0; i < 8; i++) {
    const y = mod(i * 122 - p / TAU * 768 * 2 + s.phase * 70, height);
    c.fillRect((i % 2) * 138, y, 54 + i * 3, 2.5); c.fillRect((i % 2) * 138, y + 7, 34, 1);
  }
  const scanY = mod(p / TAU * 768 * 2 + s.phase * 90, height);
  for (const yy of [scanY, scanY - height, scanY + height]) {
    const scan = c.createLinearGradient(0, yy - 35, 0, yy + 35); scan.addColorStop(0, 'transparent'); scan.addColorStop(.5, '#ffe5fc'); scan.addColorStop(1, 'transparent');
    c.globalAlpha = .13; c.fillStyle = scan; c.fillRect(0, yy - 35, width, 70);
  }
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = .095; c.fillStyle = '#291140';
  for (let y = 0; y < height; y += 5) c.fillRect(0, y, width, .8);
  c.globalAlpha = .08; c.fillStyle = '#b9e4ff'; c.fillRect(0, 0, width, height); c.globalAlpha = 1;
  const circuit=naturalLights.panelLevel(s.name,fullTime);
  if(circuit<1){c.fillStyle='#090b18';c.globalAlpha=1-circuit;c.fillRect(0,0,width,height);c.globalAlpha=1;}
}
function mapScreen(s) {
  ctx.save(); polygon(ctx, s.quad, SX, SY); ctx.clip();
  // Thin affine strips follow both sides of the existing perspective quadrilateral.
  const [a, b, c, d] = s.quad, steps = 48, sh = s.panel.height / steps;
  for (let i = 0; i < steps; i++) {
    const u = i / steps, v = (i + 1) / steps;
    const lx = (a[0] + (d[0] - a[0]) * u) * SX, ly = (a[1] + (d[1] - a[1]) * u) * SY;
    const rx = (b[0] + (c[0] - b[0]) * u) * SX, ry = (b[1] + (c[1] - b[1]) * u) * SY;
    const nx = (a[0] + (d[0] - a[0]) * v) * SX, ny = (a[1] + (d[1] - a[1]) * v) * SY;
    ctx.save(); ctx.transform((rx - lx) / s.panel.width, (ry - ly) / s.panel.width, (nx - lx) / sh, (ny - ly) / sh, lx, ly);
    ctx.drawImage(s.panel, 0, i * sh, s.panel.width, sh, 0, 0, s.panel.width, sh + .22); ctx.restore();
  }
  ctx.restore();
  if (s.occlusion) { ctx.save(); polygon(ctx, s.occlusion, SX, SY); ctx.clip(); ctx.drawImage(nightBase, 0, 0, W, H); ctx.restore(); }
}
function drawLights(p) {
  // Architectural LED cores stay steady; bloom is localized to their painted sources.
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .105;
  ctx.drawImage(cyanCore, 0, 0, W, H); ctx.globalAlpha = .18; ctx.drawImage(cyanBloom, 0, 0, W, H);
  ctx.globalAlpha = .055; ctx.drawImage(magentaCore, 0, 0, W, H); ctx.globalAlpha = 1;
  // Slow upward facade-light activity stays within the existing cyan sources.
  // The central source remains steady; only a restrained detail band travels.
  for(let y=0;y<390;y+=6) {
    const u=mod(y/390-p/TAU*2,1),band=Math.exp(-Math.pow((u-.48)/.11,2));
    ctx.globalAlpha=.052*band;
    ctx.drawImage(cyanCore,1040,y,205,6,1040*SX,y*SY,205*SX,6*SY);
  }
  ctx.globalAlpha = 1;
  const tower = 1;
  glow(ctx, W * .682, H * .29, W * .061, H * .28, '113,218,255', .087 * tower);
  glow(ctx, W * .674, H * .39, W * .107, H * .16, '71,178,244', .039 * tower);
  glow(ctx, W * .70, H * .51, W * .093, H * .065, '173,231,255', .10 * tower);
  glow(ctx, W * .827, H * .209, W * .020, H * .060, '224,65,198', .072);
  glow(ctx, W * .49, H * .54, W * .024, H * .066, '250,98,198', .071);
  glow(ctx, W * .899, H * .49, W * .025, H * .12, '255,102,192', .075);
  glow(ctx, W * .98, H * .20, W * .023, H * .18, '243,67,193', .046);
  naturalLights.draw(p/TAU*D,sceneEmission);
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 1;
  // Reflections inherit their source hue, modulated by shallow water, not global flashes.
  for (let y = 818; y < AH; y += 5) {
    ctx.globalAlpha = .09 + .065 * Math.sin(p * 8 + y * .47);
    ctx.drawImage(floorCyan, 0, y, AW, 5, 0, y * SY, W, 5 * SY);
    ctx.globalAlpha = .055 + .045 * Math.sin(p * 6 + y * .39 + .5);
    ctx.drawImage(floorMagenta, 0, y, AW, 5, 0, y * SY, W, 5 * SY);
  }
  ctx.globalAlpha = 1;
  glow(ctx, W * .677, H * .952, W * .13, H * .025, '136,223,255', .044 * tower);
  glow(ctx, W * .909, H * .95, W * .086, H * .025, '247,102,206', .039);
}
function draw(t,{omitLifeLayer=null}={}) {
  const timings=process.argv.includes('--benchmark')?[]:null;let last=performance.now();const mark=n=>{if(timings){const now=performance.now();timings.push([n,now-last]);last=now;}};
  // Canonical phase also makes exact endpoint validation reproducible.
  const p = mod(t, D) / D * TAU;
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(nightBase, 0, 0, W, H);
  mark('plate');weather.sky(t);weather.searchlight(t);mark('weather');
  for (const s of screens) {
    drawScreenContent(s, p);
    const power=measureScreenEmission(s.c,s.panel.width,s.panel.height,oledTransfer.channel);
    const luminance=power.brightness;
    s.emission=power;
    details.setScreenEmission(s.name,luminance);
    sceneEmission[s.name]=luminance;
    ctx.globalCompositeOperation = 'screen';
    const b=s.bounds;
    glow(ctx,(b.x+b.w/2)*SX,(b.y+b.h/2)*SY,b.w*SX*.82,b.h*SY*.63,power.glowColor,.026+luminance*.041);
    ctx.globalCompositeOperation = 'source-over';
    mapScreen(s);
  }
  mark('screens');drawLights(p);mark('lights');
  for(const key of ['windows','drones'])if(omitLifeLayer!==key&&omitLifeLayer!=='all')cityLife.layers[key](t);
  for(const key of ['vapor','flows','traffic','elevators','av'])if(omitLifeLayer!==key&&omitLifeLayer!=='district')blueDistrict.layers[key](t);
  mark('new city');details.drawCity(p * ambientCycles,p);mark('traffic');
  ctx.save();
  // Far aircraft pass behind the unchanged skyline rather than over facades.
  polygon(ctx, SKYLINE, SX,SY);ctx.clip();
  for (const f of craft) {
    const u = mod(f.x + f.dir * mod(t, D) / D * f.laps, 1), x = u * W * .87, y = (f.y + .009 * Math.sin(p + f.phase)) * H, z = f.size;
    ctx.globalAlpha = Math.min(1, u * 12, (1 - u) * 12);
    glow(ctx, x, y, z * 14, z * 4, '80,220,255', .25); ctx.strokeStyle = 'rgba(74,230,255,.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - f.dir * z * 15, y + 1); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#132237'; ctx.beginPath(); ctx.moveTo(x - z * 2.5, y); ctx.lineTo(x, y - z * .8); ctx.lineTo(x + z * 2.5, y); ctx.lineTo(x + z, y + z * .6); ctx.lineTo(x - z, y + z * .6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9df5ff'; ctx.fillRect(x - z * 1.8, y, z, 1.8); ctx.fillStyle = '#fc4bad'; ctx.fillRect(x + z, y, 2, 1.8); ctx.globalCompositeOperation = 'screen';
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  for (const m of mist) {
    const x = m.x + 90 * Math.sin(p + m.phase), y = m.y + 12 * Math.cos(p * 2 + m.phase);
    const blueAffinity = Math.exp(-Math.pow((x / W - .675) / .17, 2));
    glow(ctx, x, y, m.r * 2.4, m.r * .29, blueAffinity > .5 ? '126,213,243' : '118,185,209', (.022 + .011 * Math.sin(p + m.phase)) * (1 + blueAffinity * .5));
  }
  mark('aircraft and mist');details.drawAtmosphere(p * ambientCycles,p,weather.state(t));
  details.drawRain(p * ambientCycles,false,p,weather.state(t));
  details.drawForegroundOcclusion();
  if(omitLifeLayer!=='foreground'&&omitLifeLayer!=='all')cityLife.foreground(t,weather.state(t).wind);
  if(omitLifeLayer!=='reflections'&&omitLifeLayer!=='all')cityLife.reflections(t);
  details.drawWater(p * ambientCycles,weather.state(t));
  mark('atmosphere rain foreground water');drawDavid(p,{glancing:omitLifeLayer!=='glances'&&omitLifeLayer!=='all'});
  details.drawRain(p * ambientCycles,true,p,weather.state(t));
  mark('character and near rain');applyOLEDGrade();mark('OLED grade');if(timings)console.log(JSON.stringify({seconds:t,timings,rgbaSha256:require('crypto').createHash('sha256').update(canvas.data()).digest('hex')}));
}

(async () => {
  art = await loadImage(output('background.png'));nightSky=await loadImage(output('night-sky.png'));prepareNightSky(); portrait = await loadImage(output('billboard-portrait.png'));
  midAd=await loadImage(output('billboard-mid.png'));prepareMidBlink(await loadImage(output('billboard-mid-blink.png')));
  prepareBlink(await loadImage(output('billboard-blink.png')));
  portraitRig=require('./portrait-rig.cjs')(portrait,blinkPatch,{createCanvas,D});
  const david = await loadImage(output('david.png')); spriteCtx.drawImage(david, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  details.prepare(nightBase,sprite);cityLife.prepare(nightBase);blueDistrict.prepare(nightBase);
  prepareCharacter();
  prepareScreens(); prepareLightMasks();
  if(process.argv.includes('--benchmark')){for(const t of [0,24,44,64])draw(t);return;}
  if(process.argv.includes('--verify-city-life')) {
    const cases=[
      {requirement:'B1',name:'central vapor',layer:'vapor',t:24,rect:[1048,330,197,67]},
      {requirement:'B2',name:'facade light streams',layer:'flows',t:24,rect:[1090,25,71,300]},
      {requirement:'B3',name:'central bridge vehicles',layer:'traffic',t:40,rect:[1062,358,181,51]},
      {requirement:'B4',name:'panoramic elevators',layer:'elevators',t:40,rect:[1133,62,60,118]},
      {requirement:'B5',name:'AV in blue light',layer:'av',t:38.5,rect:[1130,329,40,22]},
      {requirement:'R2',name:'courier approach',layer:'drones',t:54,rect:[526,378,35,24]},
      {requirement:'R2',name:'courier landing',layer:'drones',t:64,rect:[556,425,42,30]},
      {requirement:'R2',name:'upper courier',layer:'drones',t:94,rect:[100,130,560,100]},
      {requirement:'R3',name:'walking silhouette',layer:'windows',t:24,rect:[200,646,17,20]},
      {requirement:'R3',name:'closing blinds',layer:'windows',t:78,rect:[200,646,17,20]},
      {requirement:'R3',name:'travelling elevator',layer:'windows',t:42,rect:[1007,552,8,43]},
      {requirement:'R4',name:'wet paving headlight',layer:'reflections',t:44,rect:[150,864,1180,76]},
      {requirement:'R4',name:'rail headlight',layer:'reflections',t:44,rect:[100,620,1300,100]},
      {requirement:'R5',name:'cables',layer:'foreground',t:34,rect:[360,680,50,80]},
      {requirement:'R5',name:'ventilation fans',layer:'foreground',t:24,rect:[110,811,50,50]},
      {requirement:'R6',name:'small head glance',layer:'glances',t:24,rect:[1240,458,160,125]}
    ];
    const measured=[];
    function compare(a,b,rect){let sum=0,signed=0,max=0,changed=0,count=0;for(let y=Math.floor(rect[1]*SY);y<Math.ceil((rect[1]+rect[3])*SY);y++)for(let x=Math.floor(rect[0]*SX);x<Math.ceil((rect[0]+rect[2])*SX);x++){let any=false;for(let k=0;k<3;k++){const i=(y*W+x)*4+k,d=Math.abs(a[i]-b[i]);sum+=d;signed+=a[i]-b[i];max=Math.max(max,d);count++;if(d)any=true;}if(any)changed++;}return {meanChannelDifference:sum/count,signedMeanChannelDifference:signed/count,maximumChannelDifference:max,changedPixels:changed};}
    for(const item of cases){
      draw(item.t);const on=Buffer.from(canvas.data());
      const name=item.name.replaceAll(' ','-');fs.writeFileSync(output('qa/life-'+name+'.png'),canvas.toBuffer('image/png'));
      draw(item.t,{omitLifeLayer:item.layer});const off=Buffer.from(canvas.data());const d=compare(on,off,item.rect);
      if(d.changedPixels<20||d.maximumChannelDifference<3)throw Error('Life effect not actually visible: '+JSON.stringify({...item,...d}));
      if(['walking silhouette','closing blinds'].includes(item.name)&&d.signedMeanChannelDifference>=-.1)throw Error('Room activity must occlude light behind glass, not add light: '+JSON.stringify({...item,...d}));
      const physical={x:Math.floor(item.rect[0]*SX),y:Math.floor(item.rect[1]*SY),w:Math.ceil((item.rect[0]+item.rect[2])*SX)-Math.floor(item.rect[0]*SX),h:Math.ceil((item.rect[1]+item.rect[3])*SY)-Math.floor(item.rect[1]*SY)};
      const roi=createCanvas(physical.w,physical.h),rc=roi.getContext('2d');
      for(const [label,data]of [['crop',on],['off',off]]){const image=rc.createImageData(physical.w,physical.h);for(let y=0;y<physical.h;y++){const start=((physical.y+y)*W+physical.x)*4;image.data.set(data.subarray(start,start+physical.w*4),y*physical.w*4);}rc.putImageData(image,0,0);fs.writeFileSync(output('qa/life-'+name+'-'+label+'.png'),roi.toBuffer('image/png'));}
      item.physical=physical;
      measured.push({...item,...d});
    }
    // Verify rotation and cable sway independently from the static new housings.
    const animated=[];
    for(const item of [{name:'rotating blades',rect:[109,815,12,12],times:[0,1]},{name:'cable sway',rect:[360,680,50,80],times:[0,70]}]){
      const frames=item.times.map(t=>{ctx.clearRect(0,0,W,H);cityLife.foreground(t,weather.state(t).wind);return Buffer.from(canvas.data());});const d=compare(...frames,item.rect);
      if(d.changedPixels<10||d.maximumChannelDifference<3)throw Error('Foreground detail is static: '+item.name);animated.push({...item,...d});
    }
    const districtMotion=[];
    for(const [name,times] of [['vapor',[0,20]],['flows',[0,7]],['traffic',[0,2]],['elevators',[0,8]],['av',[38,39]]]){
      const buffers=[...times,D,0].map(t=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);blueDistrict.layers[name](t);return Buffer.from(canvas.data());});
      const d=compare(buffers[0],buffers[1],[1028,18,272,560]),loop=compare(buffers[2],buffers[3],[1028,18,272,560]);
      if(d.changedPixels<20||loop.maximumChannelDifference!==0)throw Error('District motion or loop failed: '+name);
      districtMotion.push({name,times,...d,loopMaximumChannelDifference:loop.maximumChannelDifference});
    }
    const lift0=blueDistrict.elevatorStates(0),lift1=blueDistrict.elevatorStates(.5),lift8=blueDistrict.elevatorStates(8);
    if(lift0[0].y!==lift1[0].y||lift0[0].y===lift8[0].y)throw Error('Elevator did not stop then travel');
    const trainRemoved=scene.cityLife.trains.length===0&&!cityLife.layers.trains&&!cityLife.trains;
    if(!trainRemoved)throw Error('Train code still active');
    drawDavid(24/D*TAU,{poseOnly:true,glancing:false});const still=Buffer.from(pose.data());drawDavid(24/D*TAU,{poseOnly:true});const turned=Buffer.from(pose.data());
    let changedHead=0,changedBelowNeck=0;for(let y=0;y<pose.height;y++)for(let x=0;x<pose.width;x++)for(let k=0;k<4;k++){const i=(y*pose.width+x)*4+k;if(still[i]!==turned[i]){if(y>posePadding+sprite.height*.20)changedBelowNeck++;else changedHead++;}}
    if(changedHead<100||changedBelowNeck)throw Error('Glance changed the body or did not render');
    const result={checkedAt:new Date().toISOString(),manifest:cityLife.manifest(),renderedFeatures:measured,foregroundMotion:animated,headGlance:{changedHeadChannels:changedHead,changedBelowNeckChannels:changedBelowNeck,rigidHeadOnly:true},allRequestedFeaturesRendered:true,trainPassesRemoved:trainRemoved,districtMotion,elevatorStopsThenMoves:true,blueDistrict:blueDistrict.manifest()};
    fs.writeFileSync(output('city-life-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
  }
  if(process.argv.includes('--verify-cloth')) {
    const t=34,p=t/D*TAU,s=weather.state(t);
    drawDavid(p,{poseOnly:true,weatherOverride:{...s,wind:0,gust:0}});const still=Buffer.from(pose.data());
    drawDavid(p,{poseOnly:true});const gust=Buffer.from(pose.data());fs.writeFileSync(output('qa/clothing-gust.png'),pose.toBuffer('image/png'));
    drawDavid(p,{poseOnly:true,clothingWet:false});const dry=Buffer.from(pose.data());
    let hemChanges=0,wetChanges=0,lowerChanges=0,minY=Infinity,maxY=-1,maxHemDelta=0;
    for(let y=0;y<pose.height;y++)for(let x=0;x<pose.width;x++)for(let k=0;k<4;k++){
      const i=(y*pose.width+x)*4+k,d=Math.abs(still[i]-gust[i]);
      if(d){hemChanges++;minY=Math.min(minY,y);maxY=Math.max(maxY,y);maxHemDelta=Math.max(maxHemDelta,d);if(y>posePadding+sprite.height*.56)lowerChanges++;}
      if(gust[i]!==dry[i])wetChanges++;
    }
    const result={checkedAt:new Date().toISOString(),gustSampleSeconds:t,changedHemChannels:hemChanges,hemChangeSourceY:[minY-posePadding,maxY-posePadding],maximumHemChannelDifference:maxHemDelta,changedWetDetailChannels:wetChanges,collarBeads:collarBeads.length,lowerBodyChangedChannels:lowerChanges,onlyLocalClothMoves:lowerChanges===0,wetDetailsActuallyRendered:wetChanges>0};
    if(hemChanges===0||lowerChanges!==0||wetChanges===0||collarBeads.length<4)throw Error(JSON.stringify(result));
    fs.writeFileSync(output('clothing-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
  }
  if(process.argv.includes('--verify-weather')) {
    const states=Array.from({length:D*FPS},(_,i)=>weather.state(i/FPS));
    const intensity=states.map(s=>s.rain),wind=states.map(s=>s.wind);
    const images={};
    for(const [name,fn,times] of [['clouds',weather.sky,[0,40,D]],['searchlight',weather.searchlight,[34,40,49,D]]]) {
      images[name]=times.map(t=>{ctx.clearRect(0,0,W,H);fn(t);const data=Buffer.from(canvas.data());fs.writeFileSync(output(`qa/${name}-${t}.png`),canvas.toBuffer('image/png'));return data;});
    }
    function delta(a,b){let sum=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);}return {mean:sum/a.length,max};}
    const cloudMotion=delta(images.clouds[0],images.clouds[1]),cloudLoop=delta(images.clouds[0],images.clouds[2]);
    const beamAppearance=delta(images.searchlight[0],images.searchlight[1]),beamEnding=delta(images.searchlight[0],images.searchlight[2]);
    const slopeDelta=Math.max(...states.slice(1).map((s,i)=>Math.abs(s.wind-states[i].wind)));
    const result={checkedAt:new Date().toISOString(),rainIntensity:{min:Math.min(...intensity),max:Math.max(...intensity)},wind:{min:Math.min(...wind),max:Math.max(...wind),maximumPerFrameStep:slopeDelta},cloudMotion,cloudLoop,beamAppearance,beamEnding,adMixSamples:[0,77,79,91,103,128].map(t=>({t,mix:weather.adMix(t)})),cloudsActuallyMove:cloudMotion.mean>0,exactCloudLoop:cloudLoop.max===0,beamFadesOut:beamEnding.max===0,searchlightVisible:beamAppearance.mean>0,feetCheck:'character-motion-check.json',fixedCamera:true};
    if(!result.cloudsActuallyMove||!result.exactCloudLoop||!result.beamFadesOut||!result.searchlightVisible||slopeDelta>.03)throw Error(JSON.stringify(result));
    fs.writeFileSync(output('weather-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
  }
  if(process.argv.includes('--verify-screens')) {
    const result={sourceResolution:[W,H],registeredNightPlateUsed:true,rectifiedScreens:screens.map(s=>({name:s.name,quad:s.quad,textureResolution:[s.texture.width,s.texture.height],occlusionPreserved:!!s.occlusion}))};
    fs.writeFileSync(output('screen-source-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
  }
  if(process.argv.includes('--verify-portrait-rig')){
    let first,lower,endpointMaximumDifference=0,lowerBodyMaximumDifference=0;
    const times=[0,1.7,3.22,8,16,24,30,36,64,91,113,D-1/FPS,D];
    for(const time of times){
      const image=portraitRig.pose(time,portraitBlinkAmount(mod(time,D))),c=image.getContext('2d');
      const base=c.getImageData(portraitRig.padding,portraitRig.padding+Math.floor(portraitRig.height*.88),portraitRig.width,Math.floor(portraitRig.height*.12)).data;
      if(!lower)lower=Buffer.from(base);for(let i=0;i<base.length;i++)lowerBodyMaximumDifference=Math.max(lowerBodyMaximumDifference,Math.abs(base[i]-lower[i]));
      const frame=Buffer.from(image.data());if(time===0)first=frame;
      if(time===D)for(let i=0;i<frame.length;i++)endpointMaximumDifference=Math.max(endpointMaximumDifference,Math.abs(frame[i]-first[i]));
      if([0,8,24,36].includes(time))fs.writeFileSync(output(`qa/portrait-rig-${time}.png`),image.toBuffer('image/png'));
    }
    const measurements=[];
    for(const time of [0,3.22,7,24,40,64,91,113])for(const s of screens){
      drawScreenContent(s,mod(time,D)/D*TAU);
      const grade=oledTransfer.channel;
      const approximate=measureScreenEmission(s.c,s.panel.width,s.panel.height,grade,4),exact=measureScreenEmission(s.c,s.panel.width,s.panel.height,grade,1);
      const error=Math.abs(approximate.linearLuminance-exact.linearLuminance);
      if(error>.004)throw Error('Screen emission sampling loses whole-panel power: '+s.name+' '+error);
      measurements.push({screen:s.name,time,approximateLinearLuminance:approximate.linearLuminance,exactLinearLuminance:exact.linearLuminance,error});
    }
    const result={sampledSeconds:times,lowerBodyMaximumDifference,lowerBodyAnchored:lowerBodyMaximumDifference===0,endpointMaximumDifference,exactRepeatedPose:endpointMaximumDifference===0,wholePanelEmissionMeasured:true,maximumPowerSamplingError:Math.max(...measurements.map(m=>m.error)),measurements,rig:portraitRig.manifest};
    fs.writeFileSync(output('portrait-rig-check.json'),JSON.stringify(result,null,2));
    if(!result.lowerBodyAnchored||!result.exactRepeatedPose)throw Error('Portrait rig is discontinuous: '+JSON.stringify(result));console.log(JSON.stringify(result));return;
  }
  if(process.argv.includes('--verify-lighting')) {
    const windows=naturalLights.windows(),active=windows.filter(w=>w.mode==='occupancy');
    const switchedPerFrame=Array(N).fill(0),population=[];
    for(let f=0;f<N;f++) {
      const t=f/FPS,previous=mod(f-1,N)/FPS;
      population.push(windows.reduce((sum,w)=>sum+naturalLights.windowLevel(w,t),0)/windows.length);
      for(const w of active)if((naturalLights.windowLevel(w,t)>.5)!==(naturalLights.windowLevel(w,previous)>.5))switchedPerFrame[f]++;
    }
    const selected=active.map(w=>({...w,visiblePoints:details.visibleSourcePoints(w.samplePoints)}))
      .filter(w=>w.visiblePoints.length>=5).sort((a,b)=>b.visiblePoints.length-a.visiblePoints.length).slice(0,14);
    function lightingFrame(t) {
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.drawImage(nightBase,0,0,W,H);drawLights(mod(t,D)/D*TAU);details.drawForegroundOcclusion();applyOLEDGrade();
      return ctx.getImageData(0,0,W,H).data;
    }
    function luminance(frame,points) {
      return points.reduce((sum,[x,y])=>{const at=(Math.floor((y+.5)*SY)*W+Math.floor((x+.5)*SX))*4;
        return sum+frame[at]*.2126+frame[at+1]*.7152+frame[at+2]*.0722;},0)/points.length;
    }
    const measuredWindows=selected.map(w=>{
      const on=mod(w.start+w.rise+1,D),off=mod(w.start+w.duration+1,D),points=w.visiblePoints;
      const onBrightness=luminance(lightingFrame(on),points),offBrightness=luminance(lightingFrame(off),points),difference=onBrightness-offBrightness;
      if(difference<35)throw Error('Apartment does not visibly switch off: '+JSON.stringify({x:w.cx,y:w.cy,difference}));
      return {x:w.cx,y:w.cy,sourcePixels:points.length,samplePoints:points,onSeconds:on,offSeconds:off,onBrightness,offBrightness,difference};
    });
    const measuredNeon=naturalLights.neon().map(n=>{
      const event=n.pulses.reduce((best,p)=>p[2]>best[2]?p:best),normalSeconds=event[0]-.3,faultSeconds=event[0]+event[1]/2;
      const normal=luminance(lightingFrame(normalSeconds),n.cells),fault=luminance(lightingFrame(faultSeconds),n.cells),difference=normal-fault;
      if(difference<8)throw Error('Neon fault does not affect its real emitting pixels: '+n.name+' '+difference);
      return {name:n.name,sourcePixels:n.cells.length,samplePoints:n.cells,normalSeconds,faultSeconds,normalBrightness:normal,faultBrightness:fault,difference};
    });
    const populationRange=Math.max(...population)-Math.min(...population),maximumSimultaneousSwitches=Math.max(...switchedPerFrame);
    if(maximumSimultaneousSwitches>8||populationRange>.05)throw Error('City lights are too synchronized');
    const result={sourcePixelsMeasured:true,manifest:naturalLights.manifest(),measuredWindows,measuredNeon,
      populationMeanBrightnessRange:populationRange,maximumSimultaneousSwitches,transitionCount:switchedPerFrame.reduce((a,b)=>a+b),
      staggeredSwitchesConfirmed:true,localNeonFaultsConfirmed:true,wholeCityPulseAbsent:true};
    fs.writeFileSync(output('lighting-check.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));return;
  }
  if(process.argv.includes('--verify-billboards')) {
    const base=createCanvas(midAd.width,midAd.height),bc=base.getContext('2d');bc.drawImage(midAd,0,0);
    const before=Buffer.from(base.data()),closed=billboardMid(2.77/D*TAU),after=Buffer.from(closed.data());
    let outsideMax=0,insideTotal=0,insideCount=0;
    for(let y=0;y<midAd.height;y++)for(let x=0;x<midAd.width;x++) {
      const inside=midEyePatches.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h),at=(y*midAd.width+x)*4;
      for(let c=0;c<3;c++) {const delta=Math.abs(after[at+c]-before[at+c]);if(inside){insideTotal+=delta;insideCount++;}else outsideMax=Math.max(outsideMax,delta);}
    }
    for(const [name,img]of [['open',base],['closed',closed]]) {const eye=createCanvas(350,210),ec=eye.getContext('2d');ec.drawImage(img,315,300,350,210,0,0,350,210);fs.writeFileSync(output(`qa/mid-eyes-${name}-rendered.png`),eye.toBuffer('image/png'));}
    const result={centralBlinkChangesOnlyEyes:outsideMax===0,outsideEyeMaximumDifference:outsideMax,insideEyeMeanDifference:insideTotal/insideCount,portraitDimensions:[midAd.width,midAd.height],blinkTimes:scene.centralBlinkTimes};
    fs.writeFileSync(output('billboard-check.json'),JSON.stringify(result,null,2));
    if(outsideMax||result.insideEyeMeanDifference<1)throw Error(JSON.stringify(result));console.log(JSON.stringify(result));return;
  }
  if (process.argv.includes('--verify-character')) {
    const times = [...new Set([0, 1.7, 3.2, 5, 6.8, 9.8, 10.4, 12.2, 13, ...scene.cityLife.glances.flatMap(e=>[e.start,e.start+e.rise,e.start+e.rise+e.hold,e.start+e.rise+e.hold+e.fall]),...scene.breathBoundaries,27,30,34,40,49,73,79,91,101,107,113,120, ...scene.postureEvents.flatMap(e=>[e.start+e.rise,e.start+e.rise+e.hold]),25, 30, 36, 41, D - 1/FPS, D])].sort((a,b)=>a-b);
    let baselineFeet, firstPose, feetMaximumDifference = 0, endpointMaximumDifference = 0;
    for (const time of times) {
      drawDavid(mod(time, D) / D * TAU,{poseOnly:true});
      const feet = poseCtx.getImageData(posePadding, posePadding + Math.floor(sprite.height * .85), sprite.width, Math.floor(sprite.height * .15)).data;
      if (!baselineFeet) baselineFeet = Buffer.from(feet);
      for (let i = 0; i < feet.length; i++) feetMaximumDifference = Math.max(feetMaximumDifference, Math.abs(feet[i] - baselineFeet[i]));
      if (time === 0) firstPose = Buffer.from(pose.data());
      if (time === D) {
        const lastPose = Buffer.from(pose.data());
        for (let i = 0; i < firstPose.length; i++) endpointMaximumDifference = Math.max(endpointMaximumDifference, Math.abs(lastPose[i] - firstPose[i]));
      }
      if ([0, 3.2, 5, 9.8, 13].includes(time)) fs.writeFileSync(output(`character-${time}.png`), pose.toBuffer('image/png'));
    }
    const result = { sampledSeconds: times, feetMaximumDifference, feetPixelIdentical: feetMaximumDifference === 0, endpointMaximumDifference, exactRepeatedPose: endpointMaximumDifference === 0 };
    fs.writeFileSync(output('character-motion-check.json'), JSON.stringify(result, null, 2));
    if (!result.feetPixelIdentical || !result.exactRepeatedPose) throw Error(JSON.stringify(result));
    console.log(JSON.stringify(result)); return;
  }
  if (process.argv.includes('--verify-source')) {
    const states = [0,1/FPS,D-2/FPS,D-1/FPS,D].map(time => { draw(time); return Buffer.from(canvas.data()); });
    const difference = (a,b) => { let total = 0, max = 0, count = 0; for (let i=0;i<a.length;i++) { if (i%4===3) continue; const d=Math.abs(a[i]-b[i]); total+=d;max=Math.max(max,d);count++; } return {mean:total/count,max}; };
    const first=difference(states[0],states[1]),last=difference(states[2],states[3]),seam=difference(states[3],states[0]),endpoint=difference(states[0],states[4]);
    const result={uncompressed:true,firstStep:first,lastStep:last,seam,endpoint,continuous:seam.mean<Math.max(first.mean,last.mean)*1.2+.03,exactRepeatedFrame:endpoint.max===0};
    fs.writeFileSync(output('source-motion-check.json'),JSON.stringify(result,null,2));
    if(!result.continuous||!result.exactRepeatedFrame)throw Error(JSON.stringify(result));
    console.log(JSON.stringify(result));return;
  }
  if (process.argv.includes('--draft')) {
    for (const seconds of [0,20,24,34,40,49,60,64,69,79,91,101,107,113,D-1/FPS]) {
      draw(seconds); fs.writeFileSync(output(`draft-${seconds}.jpg`), canvas.toBuffer('image/jpeg', { quality: .95 }));
    }
    console.log(JSON.stringify({ draft: true, windows: windowLights.length, screens: screens.length })); return;
  }
  const startFrame=chunkIndex===null?0:chunkIndex*N/2,endFrame=chunkIndex===null?N:(chunkIndex+1)*N/2;
  const encodedOutput=chunkIndex===null?'night-city-fixed-4k.mp4':`qa/chunk-${chunkIndex}.mp4`;
  const encoder = spawn(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', String(FPS), '-i', 'pipe:0', '-an', '-vf', 'scale=in_range=pc:out_range=pc:out_color_matrix=bt709', '-c:v', 'libx264', '-threads','3','-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-color_range','pc','-colorspace','bt709','-color_primaries','bt709','-color_trc','iec61966-2-1','-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1:video_full_range_flag=1','-movflags', '+faststart', output(encodedOutput)], { stdio: ['pipe', 'ignore', 'inherit'] });
  const completed = new Promise((resolve, reject) => { encoder.on('error', reject); encoder.on('close', c => c === 0 ? resolve() : reject(Error(`encoder ${c}`))); });
  for (let i = startFrame; i < endFrame; i++) {
    draw(i / FPS);
    if ([0,60,150,270,390,720,960,1200,1920,2730,3390,N-1].includes(i)) fs.writeFileSync(output(`check-${i}.jpg`), canvas.toBuffer('image/jpeg', { quality: .95 }));
    if (i === 0) fs.writeFileSync(output('poster.png'), canvas.toBuffer('image/png'));
    if (!encoder.stdin.write(canvas.data())) await new Promise(r => encoder.stdin.once('drain', r));
    if (i && i % 120 === 0) console.log(`Rendered ${i}/${N} frames`);
  }
  encoder.stdin.end(); await completed;
  draw(0); const first = Buffer.from(canvas.data()); draw(D); const last = Buffer.from(canvas.data()); let max = 0, changed = 0;
  for (let i = 0; i < first.length; i++) { const delta = Math.abs(first[i] - last[i]); max = Math.max(max, delta); if (delta) changed++; }
  const validation = { width: W, height: H, fps: FPS, duration: D, frames: N, generatedArtworkWidth: nightSky.width, generatedArtworkHeight: nightSky.height, originalCoordinateGrid:[AW,AH],
    camera: { scale: 1, translationX: 0, translationY: 0 }, characterMovement: { method: 'rigid head and torso with feathered neck and hip joints', breathingCycleSeconds: scene.breathBoundaries.slice(1).map((v,i)=>v-scene.breathBoundaries[i]), maximumBreathLiftPixels: Math.max(...scene.breathLiftsPixels), maximumTorsoLeanDegrees: .22, maximumRelativeHeadTiltDegrees: 2.55, postureEvents: scene.postureEvents, jacketWidthScaling: false, horizontalStripWarping: false, feetAnchored: true },
    lighting: { independentWindowCount: windowLights.length, occupancyEvents: windowLights.filter(w => w.mode==='occupancy').length, naturalCityLighting: naturalLights.manifest(), steadyBlueTower: true, sourceAlignedBloom: true, animatedWetReflections: true },
    characterLighting:{reflectiveSilverTrimRespondsToNearbyNeon:true,bodyShapePreserved:true},
    oledNight:{generatedNightRelighting:true,fixedCompositionPreserved:true,emitterAndOcclusionSource:'registered refined midnight plate',originalAssetsPreservedOnDisk:true,shadowToneCurve:{blackOffset:8,gamma:1.20,softBlackGate:[15,29]},peakHighlightsPreserved:true},
    colorEncoding:{matrix:'bt709',primaries:'bt709',transfer:'iec61966-2-1',range:'pc'},
    detailLayers: details.manifest,cityLife:cityLife.manifest(),blueDistrict:blueDistrict.manifest(),weather:weather.manifest,clothing:{collarRainBeads:collarBeads.length,isolatedHem:true,maximumHemAngleDegrees:.55,bodyWidthScaling:false},
    screens: { count: screens.length, contentMovement: true, animatedPortrait: true,portraitRig:portraitRig.manifest,artworkSourceResolution:[W,H],registeredNightPlateUsed:true,originalPosterIllustrationsRigid:true,originalPosterGraphicsAnimated:true,emissionSampling:{wholePanel:true,linearRGB:true,nightGradeApplied:true,stride:4}, portraitBlinkTimesSeconds: scene.portraitBlinkTimes, centralPortraitBlinkTimesSeconds:scene.centralBlinkTimes, centralPortraitArtworkResolution:[midAd.width,midAd.height], animatedGraphics: true, refreshScan: true, perspectiveClipping: true, foregroundOcclusionPreserved: true },
    loopMaximumChannelDifference: max, loopChangedChannels: changed };
  fs.writeFileSync(output(chunkIndex===null?'validation.json':`qa/chunk-${chunkIndex}-validation.json`), JSON.stringify({...validation,encodedFrameRange:[startFrame,endFrame]}, null, 2)); console.log(JSON.stringify(validation));
})();
