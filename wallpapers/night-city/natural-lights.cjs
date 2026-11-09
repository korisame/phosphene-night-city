// Independent, periodic city circuits. Most lights stay steady, just as in a city.
module.exports = function naturalLights(ctx, {W,H,AW,AH,D,createCanvas,glow,scene}) {
  const SX=W/AW,SY=H/AH;
  let seed=914731,windows=[],neon=[];
  const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const mod=(x,m)=>(x%m+m)%m;
  const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(10+x*(-15+x*6));};
  const districts=[
    {name:'waterfront',x:368,y:650,rx:145,ry:63,color:'255,184,113'},
    {name:'residential',x:686,y:615,rx:145,ry:101,color:'250,174,112'},
    {name:'central blocks',x:951,y:518,rx:130,ry:104,color:'250,191,137'},
    {name:'eastern blocks',x:1355,y:570,rx:147,ry:120,color:'255,175,115'}
  ];
  // Brief maintenance faults affect small existing circuits, never the whole skyline.
  const circuits=[
    {name:'pink bridge segment',color:'pink',quad:[[943,582],[1029,594],[1029,599],[943,588]],
      pulses:[[5.43,.12,.45],[5.65,.08,.24],[19.01,.10,.18]]},
    {name:'cyan service panel',color:'blue',quad:[[765,626],[786,623],[788,662],[766,665]],
      pulses:[[18.23,.16,.29],[18.47,.10,.43]]},
    {name:'roof neon circuit',color:'pink',quad:[[940,219],[1000,229],[1000,235],[940,226]],
      pulses:[[31.46,.21,.34]]},
    {name:'right facade trim',color:'pink',quad:[[1549,427],[1561,427],[1561,579],[1549,579]],
      pulses:[[42.16,.10,.20],[42.32,.12,.35]]}
  ];
  for(const c of circuits)if(scene.neonFaultSchedules?.[c.name])c.pulses=scene.neonFaultSchedules[c.name];
  const panelPulses={small:scene.smallDisplayFaults??[[29.05,.15,.16],[29.29,.10,.24]]};
  const dwell=scene.windowOnDwellSeconds??[16,40];
  if(dwell[0]<=1||dwell[1]>=D||dwell[0]>dwell[1])throw Error('Invalid room dwell limits');
  function pulse(t,[start,duration,depth]) {
    const age=mod(t-start,D),edge=Math.min(.035,duration*.28);
    return age<duration?depth*ease(age/edge)*ease((duration-age)/edge):0;
  }
  function circuitLevel(t,pulses) {return 1-Math.max(0,...pulses.map(p=>pulse(t,p)));}
  function windowLevel(w,t) {
    if(w.mode==='steady')return 1;
    if(w.mode==='unlit')return w.minimum;
    if(w.mode==='interior') {
      const position=mod(t/D+w.phase,1)*w.knots.length,index=Math.floor(position),u=position-index;
      return w.knots[index]*(1-ease(u))+w.knots[(index+1)%w.knots.length]*ease(u);
    }
    const age=mod(t-w.start,D);
    const on=ease(age/w.rise)*ease((w.duration-age)/w.fall);
    return w.minimum+(1-w.minimum)*on;
  }
  function prepare(source,paintedWindows,pointInQuad,screens) {
    windows=paintedWindows;
    for(const w of windows) {
      const selection=rnd();
      w.mode=selection<.035?'unlit':selection<.115?'occupancy':selection<.205?'interior':'steady';
      w.minimum=.035+rnd()*.055;
      w.start=rnd()*D;w.duration=dwell[0]+rnd()*(dwell[1]-dwell[0]);
      // Interior lamps settle quickly on switch-on, with different dwell times per room.
      w.rise=.22+rnd()*.46;w.fall=.20+rnd()*.60;
      w.phase=rnd();w.gain=.23+rnd()*.15;
      w.knots=Array.from({length:5+Math.floor(rnd()*4)},()=>.81+rnd()*.19);
      w.district=districts.findIndex(d=>Math.abs(w.cx-d.x)<d.rx&&Math.abs(w.cy-d.y)<d.ry);
    }
    const PW=source.width,PH=source.height,PX=PW/AW,PY=PH/AH;
    const pixels=source.getContext('2d').getImageData(0,0,PW,PH).data;
    neon=circuits.map(c=>{
      const xs=c.quad.map(q=>q[0]),ys=c.quad.map(q=>q[1]),pad=8;
      const pixelPad=Math.ceil(pad*Math.max(PX,PY));
      const x=Math.floor(Math.min(...xs)*PX)-pixelPad,y=Math.floor(Math.min(...ys)*PY)-pixelPad;
      const width=Math.ceil(Math.max(...xs)*PX)-x+pixelPad,height=Math.ceil(Math.max(...ys)*PY)-y+pixelPad;
      const core=createCanvas(width,height),dark=createCanvas(width,height),cc=core.getContext('2d'),dc=dark.getContext('2d');
      const ci=cc.createImageData(width,height),di=dc.createImageData(width,height),cells=[];
      for(let yy=pixelPad;yy<height-pixelPad;yy++)for(let xx=pixelPad;xx<width-pixelPad;xx++) {
        const px=x+xx,py=y+yy,ax=(px+.5)/PX-.5,ay=(py+.5)/PY-.5,at=(py*PW+px)*4,i=(yy*width+xx)*4;
        if(!pointInQuad(ax,ay,c.quad)||screens.some(s=>pointInQuad(ax,ay,s.quad)))continue;
        const r=pixels[at],g=pixels[at+1],b=pixels[at+2];
        const matches=c.color==='pink'?r>115&&b>100&&g<Math.min(r,b)*.80:b>125&&g>100&&r<g*.80;
        if(!matches)continue;
        cells.push([ax,ay]);
        ci.data[i]=r;ci.data[i+1]=g;ci.data[i+2]=b;ci.data[i+3]=190;
        di.data[i]=r*.16;di.data[i+1]=g*.16;di.data[i+2]=b*.16;di.data[i+3]=255;
      }
      cc.putImageData(ci,0,0);dc.putImageData(di,0,0);
      const halo=createCanvas(width,height),hc=halo.getContext('2d');hc.filter=`blur(${3*Math.max(PX,PY)}px)`;hc.drawImage(core,0,0);
      return {...c,x:x/PX,y:y/PY,pixelScaleX:PX,pixelScaleY:PY,core,dark,halo,cells};
    });
    for(const n of neon)if(n.cells.length<8)throw Error('Neon circuit did not match the painted source: '+n.name);
  }
  function draw(t,emission) {
    for(const w of windows) {
      const level=windowLevel(w,t);
      // Darken the actual emitting pixels first. Architecture and window surrounds stay intact.
      ctx.globalCompositeOperation='source-over';ctx.globalAlpha=(1-level)*.97;
      ctx.drawImage(w.dark,w.x*SX,w.y*SY,w.dark.width*SX/w.pixelScaleX,w.dark.height*SY/w.pixelScaleY);
      ctx.globalCompositeOperation='screen';ctx.globalAlpha=w.gain*level;
      ctx.drawImage(w.light,w.x*SX,w.y*SY,w.light.width*SX/w.pixelScaleX,w.light.height*SY/w.pixelScaleY);
    }
    for(const n of neon) {
      const level=circuitLevel(t,n.pulses);
      ctx.globalCompositeOperation='source-over';ctx.globalAlpha=(1-level)*.95;
      ctx.drawImage(n.dark,n.x*SX,n.y*SY,n.dark.width*SX/n.pixelScaleX,n.dark.height*SY/n.pixelScaleY);
      ctx.globalCompositeOperation='screen';ctx.globalAlpha=.23*level;
      ctx.drawImage(n.halo,n.x*SX,n.y*SY,n.halo.width*SX/n.pixelScaleX,n.halo.height*SY/n.pixelScaleY);
    }
    ctx.globalCompositeOperation='screen';ctx.globalAlpha=1;
    // Warm neighbourhood haze follows the local occupied rooms, with no synchronized pulse.
    for(let i=0;i<districts.length;i++) {
      const d=districts[i],rooms=windows.filter(w=>w.district===i);
      const power=rooms.reduce((sum,w)=>sum+windowLevel(w,t),0)/Math.max(1,rooms.length);
      glow(ctx,d.x*SX,d.y*SY,d.rx*SX,d.ry*SY,d.color,.013*power);
      emission[d.name]=power;
    }
    // Advertising light spills into nearby vapour and the painted wet foreground.
    const pink=.42+.31*(emission.portrait??.3)+.20*(emission.mid??.3);
    glow(ctx,1511*SX,582*SY,82*SX,76*SY,'246,95,205',.035*pink);
    glow(ctx,920*SX,424*SY,56*SX,49*SY,'233,101,203',.022*(.4+(emission.mid??.3)));
    const reflections=[{x:980,y:900,rx:47,ry:14,color:'248,95,204',screen:'mid'},
      {x:1510,y:905,rx:86,ry:17,color:'254,112,209',screen:'portrait'}];
    for(const r of reflections) {
      ctx.save();ctx.beginPath();ctx.rect(0,AH*.881*SY,W,H-AH*.881*SY);ctx.clip();
      glow(ctx,r.x*SX,r.y*SY,r.rx*SX,r.ry*SY,r.color,.024*(.4+(emission[r.screen]??.3)));
      ctx.restore();
    }
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  }
  function manifest() {
    const counts=Object.fromEntries(['steady','unlit','occupancy','interior'].map(mode=>[mode,windows.filter(w=>w.mode===mode).length]));
    return {counts,emitterMaskResolution:[W,H],nativePixelWindowShapes:true,independentWindowSchedules:true,windowSwitchFadeSeconds:[.20,.80],windowOnDwellSeconds:dwell,
      neonCircuits:neon.map(({name,quad,pulses,cells})=>({name,quad,pulses,sourcePixelCount:cells.length})),
      smallDisplayFaults:panelPulses.small,localGlowFollowsEmittingSources:true,mainBlueTowerSteady:true};
  }
  return {prepare,draw,manifest,windowLevel,circuitLevel,windows:()=>windows,neon:()=>neon,
    panelLevel:(name,t)=>circuitLevel(t,panelPulses[name]??[])};
};
