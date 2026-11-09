const { createCanvas } = require('@napi-rs/canvas');

// All coordinates describe the original fixed viewpoint. Motion belongs to
// rain, water, vehicles and steam; no scene or camera transform is animated.
module.exports = function createDetails(ctx, { W, H, AW, AH, D }) {
  const TAU = Math.PI * 2, SX = W / AW, SY = H / AH;
  const mod = (x, n) => (x % n + n) % n;
  const clamp = x => Math.max(0, Math.min(1, x));
  let seed = 318517;
  const rnd = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const rain = [
    { count: 920, depth: 0, length: [8, 22], alpha: [.025, .075], width: [.35, .75], laps: [7, 11] },
    { count: 330, depth: 1, length: [24, 51], alpha: [.075, .15], width: [.65, 1.20], laps: [9, 14] },
    { count: 68, depth: 2, length: [62, 115], alpha: [.085, .18], width: [1.1, 1.9], laps: [12, 17] }
  ].flatMap(layer => Array.from({length: layer.count}, () => ({
    depth: layer.depth, x: rnd() * W, y: rnd() * H,
    length: layer.length[0] + rnd() * (layer.length[1] - layer.length[0]),
    alpha: layer.alpha[0] + rnd() * (layer.alpha[1] - layer.alpha[0]),
    width: layer.width[0] + rnd() * (layer.width[1] - layer.width[0]),
    laps: layer.laps[0] + Math.floor(rnd() * (layer.laps[1] - layer.laps[0] + 1)),
    phase: rnd() * TAU, slope: .082 + rnd() * .04
  })));
  const impacts = Array.from({length: 74}, () => {
    const depth = rnd(), y = .909 + depth * .087;
    return { x: .015 + rnd() * .98, y, phase: rnd(), laps: 8 + Math.floor(rnd() * 7),
      radius: 9 + depth * 25 + rnd() * 12, alpha: .09 + depth * .09 };
  });
  const lanes = [
    { points: [[108,544],[257,537],[430,540],[619,553],[835,578],[1037,603],[1242,629]], count: 18, scale: .8, laps: 1, dir: 1 },
    { points: [[112,548],[258,541],[430,544],[620,557],[835,582],[1037,607],[1242,633]], count: 15, scale: .65, laps: 1, dir: -1 },
    { points: [[962,409],[1070,403],[1178,394],[1287,387]], count: 7, scale: .32, laps: 1, dir: -1 },
    { points: [[1030,361],[1128,355],[1235,349],[1345,344]], count: 8, scale: .27, laps: 1, dir: 1 }
  ];
  for (const lane of lanes) {
    lane.lengths = [0];
    for (let i=1;i<lane.points.length;i++) {
      const a=lane.points[i-1], b=lane.points[i];
      lane.lengths.push(lane.lengths.at(-1)+Math.hypot(b[0]-a[0],b[1]-a[1]));
    }
    lane.length=lane.lengths.at(-1);
    lane.vehicles=Array.from({length:lane.count},(_,i)=>({phase:(i+.18+rnd()*.5)/lane.count, size:1.7+rnd()*1.9, cool:rnd()>.22, laps:Math.round(D/16)+(i%5)-2, driftPhase:rnd()*TAU}));
  }
  function onLane(lane,u) {
    const d=clamp(u)*lane.length;
    let i=1; while(i<lane.lengths.length-1&&lane.lengths[i]<d)i++;
    const a=lane.points[i-1],b=lane.points[i],v=(d-lane.lengths[i-1])/(lane.lengths[i]-lane.lengths[i-1]);
    return {x:(a[0]+(b[0]-a[0])*v)*SX,y:(a[1]+(b[1]-a[1])*v)*SY,angle:Math.atan2((b[1]-a[1])*SY,(b[0]-a[0])*SX)};
  }
  const beacons = [[755,151],[804,90],[945,122],[1123,166],[1225,94],[1388,42],[1461,96],[674,320],[601,378]].map((xy,i)=>({x:xy[0]*SX,y:xy[1]*SY,phase:rnd(),laps:3+i%2}));
  const vents = [
    { x: 782, y: 593, height: 35, width: 20, drift: -15, count: 7, gain:.095 },
    { x: 1248, y: 591, height: 43, width: 22, drift: 17, count: 8, gain:.08 },
    { x: 998, y: 535, height: 44, width: 21, drift: 19, count: 8, gain:.07 },
    { x: 113, y: 790, height: 45, width: 14, drift: -12, count: 6, gain:.065 }
  ];
  const puff = createCanvas(160,160), pc=puff.getContext('2d');
  for(let i=0;i<18;i++) {
    const x=80+(rnd()-.5)*55,y=80+(rnd()-.5)*43,r=21+rnd()*28;
    const g=pc.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,'rgba(145,205,226,.30)');g.addColorStop(.44,'rgba(114,179,209,.17)');g.addColorStop(1,'rgba(114,179,209,0)');
    pc.fillStyle=g;pc.fillRect(x-r,y-r,r*2,r*2);
  }
  const dripAnchors = [[185,697],[377,686],[635,673],[906,658],[1138,648],[1493,630],[1660,621]];
  const drips = dripAnchors.flatMap((xy,i)=>Array.from({length:3},(_,j)=>({x:(xy[0]+j*2.5)*SX,y:xy[1]*SY,phase:rnd(),laps:5+i%3,height:(21+rnd()*18)*SY,gain:.12+rnd()*.08})));
  const reflection=createCanvas(W,H),rc=reflection.getContext('2d');
  let lightField,railOcclusion,footContacts,foregroundMaskPixels;
  const emissions={};
  function prepare(image,sprite) {
    const field=createCanvas(96,54),fc=field.getContext('2d');fc.drawImage(image,0,0,96,54);lightField=fc.getImageData(0,0,96,54).data;
    const mask=createCanvas(AW,AH),mc=mask.getContext('2d');
    mc.strokeStyle='#fff';mc.lineCap='butt';mc.lineWidth=18;
    mc.beginPath();mc.moveTo(0,706);mc.lineTo(AW,622);mc.stroke();
    mc.lineWidth=12;mc.beginPath();mc.moveTo(0,750);mc.lineTo(AW,650);mc.stroke();
    for(const [x,y,h,w]of [[124,698,175,13],[394,684,156,14],[807,668,147,12],[1246,648,132,12],[1530,631,131,14]])mc.fillRect(x-w/2,y,w,h);
    foregroundMaskPixels=mc.getImageData(0,0,AW,AH).data;
    railOcclusion=createCanvas(W,H);const c=railOcclusion.getContext('2d');c.drawImage(image,0,0,W,H);c.globalCompositeOperation='destination-in';c.drawImage(mask,0,0,W,H);
    if(sprite) {
      const p=sprite.getContext('2d').getImageData(0,0,sprite.width,sprite.height).data;
      footContacts=[{minX:sprite.width,maxX:0,maxY:0},{minX:sprite.width,maxX:0,maxY:0}];
      for(let y=Math.floor(sprite.height*.875);y<sprite.height;y++)for(let x=0;x<sprite.width;x++) {
        const at=(y*sprite.width+x)*4;if(p[at+3]<240||p[at]+p[at+1]+p[at+2]<80)continue;
        const f=footContacts[x<sprite.width*.53?0:1];f.minX=Math.min(f.minX,x);f.maxX=Math.max(f.maxX,x);f.maxY=Math.max(f.maxY,y);
      }
    }
  }
  function setScreenEmission(name,value) {emissions[name]=value;}
  function rainColor(x,y) {
    const u=x/W,v=y/H,at=(Math.min(53,Math.floor(v*54))*96+Math.min(95,Math.floor(u*96)))*4;
    const r=lightField?.[at]??20,g=lightField?.[at+1]??35,b=lightField?.[at+2]??60;
    const pink=Math.exp(-Math.pow((u-.895)/.065,2)-Math.pow((v-.49)/.23,2))*(.66+(emissions.portrait??.3)*.4)
      +.45*Math.exp(-Math.pow((u-.54)/.06,2)-Math.pow((v-.37)/.14,2));
    const blue=Math.exp(-Math.pow((u-.685)/.18,2)-Math.pow((v-.35)/.43,2));
    const warm=r>g*1.13&&g>b*1.1?.24:0;
    return {rgb:`${Math.round(145+pink*70+warm*60)},${Math.round(206-pink*45+blue*25-warm*20)},${Math.round(237-pink*5+blue*15-warm*66)}`,gain:.56+Math.min(1,(r+g+b)/470)*.48};
  }
  function drawForegroundOcclusion() {
    if(!railOcclusion)return;ctx.save();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.drawImage(railOcclusion,0,0,W,H);ctx.restore();
  }
  function visibleSourcePoints(points) {
    return points.filter(([x,y])=>foregroundMaskPixels[(Math.floor(y)*AW+Math.floor(x))*4+3]===0);
  }
  const riverGlints=Array.from({length:95},()=>({x:171+rnd()*216,y:579+rnd()*63,phase:rnd(),width:2+rnd()*10,laps:3+Math.floor(rnd()*3),gain:.06+rnd()*.12}));
  function riverContains(x,y) {
    const q=[[166,575],[369,576],[391,617],[324,638],[242,654],[211,646],[174,638]];
    let inside=false;
    for(let i=0,j=q.length-1;i<q.length;j=i++) {
      const a=q[i],b=q[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
  }

  function halo(x,y,rx,ry,rgb,a) {
    if(a<=0)return;
    ctx.save();ctx.translate(x,y);ctx.scale(1,ry/rx);
    const g=ctx.createRadialGradient(0,0,0,0,0,rx);
    g.addColorStop(0,`rgba(${rgb},${a})`);g.addColorStop(.33,`rgba(${rgb},${a*.37})`);g.addColorStop(1,`rgba(${rgb},0)`);
    ctx.fillStyle=g;ctx.fillRect(-rx,-rx,rx*2,rx*2);ctx.restore();
  }
  function drawCity(p,longPhase) {
    ctx.save();ctx.globalCompositeOperation='screen';
    for(const g of riverGlints) {
      if(!riverContains(g.x,g.y))continue;
      const u=mod(p/TAU*g.laps+g.phase,1),gain=Math.pow(Math.sin(u*Math.PI),2)*g.gain;
      const w=g.width*(.6+(g.y-579)/63*.6)*SX;
      ctx.strokeStyle=`rgba(133,218,249,${gain})`;ctx.lineWidth=.55;
      ctx.beginPath();ctx.moveTo(g.x*SX-w/2,g.y*SY);ctx.lineTo(g.x*SX+w/2,g.y*SY);ctx.stroke();
    }
    for(const lane of lanes) for(const car of lane.vehicles) {
      const slowDrift=.018*(Math.sin(longPhase+car.driftPhase)-Math.sin(car.driftPhase));
      const u=mod(car.phase+lane.dir*(longPhase/TAU*car.laps+slowDrift),1),a=Math.min(1,u*25,(1-u)*25),q=onLane(lane,u);
      const z=car.size*lane.scale*SX,rgb=car.cool?'136,239,255':'255,151,124';
      // Two tiny lamps remain within the road deck, with a short restrained trail.
      ctx.globalAlpha=a;halo(q.x,q.y,z*3.7,z*1.15,rgb,.31);
      ctx.save();ctx.translate(q.x,q.y);ctx.rotate(q.angle);
      ctx.strokeStyle=`rgba(${rgb},.62)`;ctx.lineWidth=Math.max(.55,lane.scale*1.1);
      ctx.beginPath();ctx.moveTo(-lane.dir*z*3.1,0);ctx.lineTo(lane.dir*z*.25,0);ctx.stroke();
      ctx.fillStyle=car.cool?'#b2faff':'#ffaaa0';ctx.fillRect(-z*.4,-z*.27,z*.65,Math.max(.6,z*.32));
      ctx.restore();
    }
    ctx.globalAlpha=1;
    for(const b of beacons) {
      const u=mod(p/TAU*b.laps+b.phase,1);
      // Soft double aviation pulse, with darkness between pulses.
      const a=.62*Math.exp(-Math.pow((u-.24)/.065,2))+.34*Math.exp(-Math.pow((u-.43)/.055,2));
      halo(b.x,b.y,8,6,'255,56,106',a*.48);
      ctx.fillStyle=`rgba(255,92,128,${a})`;ctx.beginPath();ctx.arc(b.x,b.y,1.1,0,TAU);ctx.fill();
    }
    ctx.restore();
  }
  function drawAtmosphere(p,longPhase,weather={wind:0,fog:1}) {
    ctx.save();ctx.globalCompositeOperation='screen';
    for(const vent of vents) for(let i=0;i<vent.count;i++) {
      const u=mod(p/TAU*4+i/vent.count,1),fade=Math.pow(Math.sin(u*Math.PI),1.6),spread=.38+u*.82;
      const x=(vent.x+vent.drift*(1+.12*Math.sin(longPhase+i*.7)+weather.wind*.20)*u+Math.sin(p*2+i*2.1)*u*2.8)*SX,y=(vent.y-vent.height*u)*SY;
      const w=vent.width*SX*spread,h=vent.height*SY*.57*spread;
      ctx.globalAlpha=vent.gain*fade*weather.fog;ctx.drawImage(puff,x-w,y-h,w*2,h*2);
    }
    ctx.restore();
  }
  function drawRain(p,near=false,longPhase,weather={rain:1,wind:0}) {
    ctx.save();ctx.globalCompositeOperation='source-over';
    if(!near) {
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W,0);ctx.lineTo(W,768*SY);ctx.lineTo(1300*SX,796*SY);ctx.lineTo(600*SX,846*SY);ctx.lineTo(0,900*SY);ctx.closePath();ctx.clip();
    }
    for(const r of rain) {
      if(near!== (r.depth===2))continue;
      const slope=r.slope+weather.wind*.035;
      const y=mod(r.y+p/TAU*r.laps*H,H),x=mod(r.x-y*slope+(r.depth+1)*2.2*Math.sin(p*2+r.phase)+1.6*Math.sin(longPhase*2+r.phase),W);
      const fade=Math.min(1,y/75,(H-y)/95),l=r.length;
      const illumination=rainColor(x,y);
      ctx.strokeStyle=`rgba(${illumination.rgb},${r.alpha*fade*illumination.gain*weather.rain})`;ctx.lineWidth=r.width;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-l*slope,y+l);ctx.stroke();
    }
    ctx.restore();
  }
  function drawWater(p,weather={rain:1}) {
    ctx.save();ctx.globalCompositeOperation='screen';
    for(const r of impacts) {
      const u=mod(p/TAU*r.laps+r.phase,1),fade=Math.pow(1-u,1.7)*Math.sin(Math.min(1,u/.15)*Math.PI/2),ry=r.radius*u*.17;
      ctx.strokeStyle=`rgba(132,223,247,${r.alpha*fade*weather.rain})`;ctx.lineWidth=.65;
      ctx.beginPath();ctx.ellipse(r.x*W,r.y*H,Math.max(.01,r.radius*u),Math.max(.01,ry),0,0,TAU);ctx.stroke();
      if(u<.16) {
        const a=r.alpha*(1-u/.16),jump=Math.sin(u/.16*Math.PI)*2.8;
        ctx.fillStyle=`rgba(174,239,255,${a})`;ctx.fillRect(r.x*W-2.2,r.y*H-jump-1,.8,1.3);ctx.fillRect(r.x*W+2.4,r.y*H-jump*.8,1,1);
      }
    }
    // Drops leave existing railing joints. Their individual phases avoid a curtain.
    for(const d of drips) {
      const u=mod(p/TAU*d.laps+d.phase,1),a=Math.sin(u*Math.PI)*d.gain*weather.rain,y=d.y+d.height*u*u;
      ctx.strokeStyle=`rgba(159,226,249,${a})`;ctx.lineWidth=.75;ctx.beginPath();ctx.moveTo(d.x,y);ctx.lineTo(d.x-.3,y+3+u*3);ctx.stroke();
    }
    ctx.restore();
  }
  function drawCharacterGround(p,pose,actor,padding,scale) {
    const sourceFloor=footContacts?Math.max(...footContacts.map(f=>f.maxY)):actor.height/scale;
    const floor=actor.y+sourceFloor*scale;
    ctx.save();ctx.globalCompositeOperation='multiply';
    // Two shoe contact shadows anchor the stationary feet on the wet balcony.
    if(footContacts)for(const f of footContacts)halo(actor.x+(f.minX+f.maxX)/2*scale,actor.y+f.maxY*scale,(f.maxX-f.minX)*scale*.57,5.5,'6,10,18',.64);
    ctx.restore();
    rc.setTransform(1,0,0,1,0,0);rc.clearRect(0,0,W,H);rc.globalAlpha=1;rc.globalCompositeOperation='source-over';
    // The inverted pose is compressed by the grazing view of the water surface.
    rc.save();rc.beginPath();rc.rect(0,floor,W,H-floor);rc.clip();rc.translate(0,floor);rc.scale(1,-.29);
    rc.drawImage(pose,actor.x-padding*scale,-sourceFloor*scale-padding*scale,pose.width*scale,pose.height*scale);rc.restore();
    rc.globalCompositeOperation='destination-in';
    const fade=rc.createLinearGradient(0,floor,0,Math.min(H,floor+180));
    fade.addColorStop(0,'rgba(255,255,255,.22)');fade.addColorStop(.18,'rgba(255,255,255,.14)');fade.addColorStop(1,'rgba(255,255,255,0)');
    rc.fillStyle=fade;rc.fillRect(0,floor,W,H-floor);rc.globalCompositeOperation='source-over';
    ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    for(let y=Math.ceil(floor);y<H;y+=3) {
      const distance=y-floor,dx=Math.sin(distance*.18+p*6)*(.4+distance*.022)+Math.sin(distance*.07-p*4)*1.1;
      ctx.drawImage(reflection,actor.x-20,y,actor.width+40,3,actor.x-20+dx,y,actor.width+40,3);
    }
    ctx.restore();
  }
  return {prepare,setScreenEmission,drawForegroundOcclusion,visibleSourcePoints,drawCity,drawAtmosphere,drawRain,drawWater,drawCharacterGround,manifest:{rainLayers:3,rainStreaks:rain.length,rainCatchesLocalLight:true,distantRainOccludedByBalcony:true,waterImpacts:impacts.length,railDrips:drips.length,riverReflectionGlints:riverGlints.filter(g=>riverContains(g.x,g.y)).length,trafficVehicles:lanes.reduce((n,l)=>n+l.count,0),trafficLanes:lanes.length,trafficTraversalSeconds:lanes.map(l=>l.vehicles.map(c=>D/c.laps)),trafficVelocityAlwaysPositive:true,slowWindPeriodSeconds:D,ventilationPlumes:vents.length,aviationBeacons:beacons.length,characterContactShadows:true,characterWetReflection:true,cameraTransformAnimated:false}};
};
