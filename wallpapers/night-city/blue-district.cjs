// Registered, local animation in the central blue district. All coordinates
// refer to the approved 1672x941 plate; nothing translates the camera or plate.
const {createCanvas}=require('@napi-rs/canvas');
const TAU=2*Math.PI,mod=(v,n)=>(v%n+n)%n,clamp=v=>Math.max(0,Math.min(1,v));
const ease=v=>{v=clamp(v);return v*v*v*(10+v*(-15+v*6));};
module.exports=(ctx,{W,H,AW,AH,D,scene})=>{
  const sx=W/AW,sy=H/AH,bounds={x:1028,y:18,w:272,h:560};
  const layer=createCanvas(Math.ceil(bounds.w*sx),Math.ceil(bounds.h*sy)),c=layer.getContext('2d');
  const airMask=createCanvas(layer.width,layer.height),ac=airMask.getContext('2d');
  const hazeMask=createCanvas(layer.width,layer.height),hc=hazeMask.getContext('2d');
  const flowMask=createCanvas(layer.width,layer.height),fc=flowMask.getContext('2d');
  const aperture=[
    [[1058,277],[1068,277],[1072,302],[1087,312],[1087,337],[1102,341],[1123,355],[1135,364],[1058,367]],
    [[1125,316],[1138,316],[1139,289],[1158,289],[1158,334],[1171,338],[1171,358],[1186,362],[1186,365],[1135,367],[1133,353],[1125,349]],
    [[1201,307],[1207,308],[1207,324],[1220,325],[1220,350],[1233,352],[1233,364],[1191,365],[1191,352],[1201,351]],
    [[1230,294],[1259,291],[1259,320],[1268,326],[1268,354],[1255,356],[1255,362],[1233,364],[1233,340],[1230,339]],
    [[1060,384],[1103,382],[1112,382],[1126,381],[1140,381],[1165,379],[1190,378],[1214,377],[1214,394],[1189,396],[1165,397],[1140,398],[1100,401],[1060,403]],
    [[1091,424],[1105,422],[1105,434],[1117,435],[1117,463],[1134,465],[1134,474],[1167,476],[1167,451],[1180,451],[1180,437],[1193,437],[1193,475],[1091,476]],
    [[1108,505],[1129,505],[1129,524],[1143,527],[1143,536],[1160,537],[1160,555],[1188,555],[1188,539],[1208,538],[1208,574],[1108,574]]
  ];
  const bridges=[
    {id:'amber upper bridge',a:[1066,368.4],b:[1239,362.5],half:1.6,count:7,laps:3,phase:.12},
    {id:'magenta middle bridge',a:[1066,404.0],b:[1237,397.2],half:1.4,count:6,laps:-2,phase:.61},
    {id:'lower blue bridge',a:[1095,480.2],b:[1184,482.0],half:1.2,count:4,laps:4,phase:.31}
  ];
  const shafts=[{id:'central glass lift',x:1138.2,top:67,bottom:166,w:2.7,h:4.2,phase:0},
    {id:'east glass lift',x:1188.0,top:114,bottom:173,w:2.2,h:3.6,phase:.41}];
  const veins=[{points:[[1144,42],[1154,48],[1154,112],[1146,116],[1146,157]],laps:4,phase:.08},
    {points:[[1154,198],[1145,205],[1145,261],[1153,267],[1153,321]],laps:-3,phase:.37},
    {points:[[1103,171],[1100,193],[1100,230],[1095,249],[1095,285]],laps:2,phase:.66}];
  for(const v of veins){v.dist=[0];for(let i=1;i<v.points.length;i++)v.dist.push(v.dist.at(-1)+Math.hypot(v.points[i][0]-v.points[i-1][0],v.points[i][1]-v.points[i-1][1]));v.length=v.dist.at(-1);}
  function poly(x,points){x.beginPath();points.forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b));x.closePath();}
  function transform(x){x.setTransform(sx,0,0,sy,-bounds.x*sx,-bounds.y*sy);}
  function reset(){c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,layer.width,layer.height);c.globalAlpha=1;c.globalCompositeOperation='source-over';transform(c);}
  function finish(mask,mode='source-over'){
    c.setTransform(1,0,0,1,0,0);if(mask){c.globalCompositeOperation='destination-in';c.drawImage(mask,0,0);}
    ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation=mode;ctx.drawImage(layer,bounds.x*sx,bounds.y*sy);ctx.restore();
  }
  const cloud=createCanvas(240,92),cc=cloud.getContext('2d');
  // Deterministic lumpy translucent texture, deliberately not a flat oval.
  for(let i=0;i<33;i++){const x=15+mod(i*71,208),y=27+Math.sin(i*1.73)*12,r=13+mod(i*17,22);const g=cc.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba(139,215,239,.17)');g.addColorStop(.43,'rgba(89,169,210,.09)');g.addColorStop(1,'rgba(35,104,163,0)');cc.fillStyle=g;cc.fillRect(x-r,y-r,r*2,r*2);}
  let prepared=false,maskPixels={};
  function prepare(image){
    transform(ac);ac.fillStyle='#fff';for(const p of aperture){poly(ac,p);ac.fill();}
    const src=createCanvas(layer.width,layer.height),sc=src.getContext('2d');sc.drawImage(image,bounds.x*sx,bounds.y*sy,layer.width,layer.height,0,0,layer.width,layer.height);
    const data=sc.getImageData(0,0,layer.width,layer.height),mask=ac.getImageData(0,0,layer.width,layer.height),hm=hc.createImageData(layer.width,layer.height);
    for(let i=0;i<data.data.length;i+=4){const [r,g,b]=data.data.subarray(i,i+3);hm.data[i]=hm.data[i+1]=hm.data[i+2]=255;
      // Suppress opaque warm/dark building pixels in addition to geometric masks.
      hm.data[i+3]=mask.data[i+3]&&b>r*1.12&&g>r*1.06&&g>65?Math.round(255*clamp((g-55)/90)):0;}
    hc.putImageData(hm,0,0);
    transform(fc);fc.fillStyle='#fff';for(const p of [ [[1141,28],[1158,37],[1158,320],[1140,320]],[[1091,169],[1108,164],[1108,286],[1091,290]] ]){poly(fc,p);fc.fill();}
    fc.setTransform(1,0,0,1,0,0);const fm=fc.getImageData(0,0,layer.width,layer.height);
    for(let i=0;i<fm.data.length;i+=4){const [r,g,b]=data.data.subarray(i,i+3);fm.data[i+3]=fm.data[i+3]&&g>125&&b>145&&r<g*.89?255:0;}
    fc.putImageData(fm,0,0);
    maskPixels={air:mask.data.filter((_,i)=>i%4===3&&mask.data[i]>0).length,vapor:hm.data.filter((_,i)=>i%4===3&&hm.data[i]>0).length,facade:fm.data.filter((_,i)=>i%4===3&&fm.data[i]>0).length};
    if(maskPixels.vapor<5000||maskPixels.facade<1000)throw Error('Blue district masks do not register to source plate');prepared=true;
  }
  function vapor(seconds){
    const p=mod(seconds,D)/D*TAU;reset();
    for(let i=0;i<16;i++){
      const band=i%4,y=[350,389,461,552][band],x=[1070,1115,1174,1223][Math.floor(i/4)];
      const drift=15*Math.sin(p*(1+i%2)+i*1.31),rise=3.7*Math.cos(p+i*1.73),width=48+(i%3)*13;
      c.globalAlpha=.64+.13*Math.sin(p+i*.7);c.drawImage(cloud,x-27+drift,y-12+rise,width,24+(i%2)*6);
    }
    c.globalAlpha=1;finish(hazeMask);
  }
  function point(v,d){let i=1;while(i<v.dist.length-1&&d>v.dist[i])i++;const u=clamp((d-v.dist[i-1])/(v.dist[i]-v.dist[i-1])),a=v.points[i-1],b=v.points[i];return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u];}
  function flows(seconds){const t=mod(seconds,D);reset();
    for(const v of veins){const head=mod(t/D*v.laps+v.phase,1),fade=ease(head/.09)*ease((1-head)/.09),d=head*v.length;
      for(let j=0;j<17;j++){const q=point(v,d-j*.65);if(d-j*.65<0)continue;c.globalAlpha=fade*(1-j/17)*.37;c.fillStyle='#b6faff';c.beginPath();c.ellipse(q[0],q[1],.64,1.2,0,0,TAU);c.fill();}}
    c.globalAlpha=1;finish(flowMask,'screen');
  }
  function trafficStates(seconds){const t=mod(seconds,D);return bridges.flatMap((b,j)=>Array.from({length:b.count},(_,i)=>{
    const u=mod(t/D*b.laps+i/b.count+b.phase,1);return {bridge:j,x:b.a[0]+(b.b[0]-b.a[0])*u,y:b.a[1]+(b.b[1]-b.a[1])*u,u,fade:ease(u/.035)*ease((1-u)/.035),dir:Math.sign(b.laps),size:j===2?.7:.92};}));}
  function traffic(seconds){reset();for(const [j,b]of bridges.entries()){
    c.save();poly(c,[[b.a[0],b.a[1]-b.half],[b.b[0],b.b[1]-b.half],[b.b[0],b.b[1]+b.half],[b.a[0],b.a[1]+b.half]]);c.clip();
    for(const s of trafficStates(seconds).filter(v=>v.bridge===j)){
      // Tiny two-lamp vehicles, individually spaced. No long carriage geometry.
      c.globalAlpha=s.fade;const angle=Math.atan2(b.b[1]-b.a[1],b.b[0]-b.a[0]);c.save();c.translate(s.x,s.y);c.rotate(angle);c.scale(s.size,s.size);
      c.fillStyle='#142435';c.beginPath();c.roundRect(-2,-1.2,4,1.8,.5);c.fill();c.fillStyle=s.dir>0?'#e0f4fa':'#e89b9e';c.fillRect(s.dir*1.7,-.9,.9,.55);c.fillRect(s.dir*1.7,.1,.9,.55);c.fillStyle='#6b9fad';c.fillRect(-.75,-1.2,1.5,.55);c.restore();
    }c.restore();}
    c.globalAlpha=1;finish();
  }
  function elevatorStates(seconds){const t=mod(seconds,D);return shafts.map(s=>{const phase=mod(t/64+s.phase,1)*4,k=Math.floor(phase),u=phase-k,stops=[0,.48,1,.48,0],position=stops[k]+(stops[k+1]-stops[k])*ease((u-.13)/.74);return {...s,y:s.top+(s.bottom-s.top)*position,stopped:u<.13||u>.87};});}
  function elevators(seconds){reset();for(const s of elevatorStates(seconds)){
    c.save();c.beginPath();c.rect(s.x-s.w/2-.4,s.top-s.h,s.w+.8,s.bottom-s.top+s.h*2);c.clip();
    c.globalAlpha=.75;c.fillStyle='#122e40';c.strokeStyle='#80cbd4';c.lineWidth=.28;c.beginPath();c.roundRect(s.x-s.w/2,s.y-s.h/2,s.w,s.h,.45);c.fill();c.stroke();
    c.fillStyle='#b8e5d8';c.globalAlpha=.82;c.fillRect(s.x-s.w*.32,s.y-s.h*.24,s.w*.64,s.h*.38);c.fillStyle='#1c4255';c.fillRect(s.x-.14,s.y-s.h*.30,.28,s.h*.64);
    c.fillStyle='#dbf6ec';c.globalAlpha=.8;c.fillRect(s.x-s.w*.38,s.y+s.h*.30,s.w*.76,.37);c.restore();}
    c.globalAlpha=1;finish();
  }
  function avStates(seconds){const t=mod(seconds,D);return scene.blueDistrict.rareAVCrossings.map(e=>{const u=(t-e.start)/e.duration,v=e.direction>0?u:1-u;return {u,x:1052+v*220,y:343-7*Math.sin(clamp(u)*Math.PI),dir:e.direction,fade:u>0&&u<1?ease(u/.1)*ease((1-u)/.1):0};});}
  function av(seconds){reset();for(const s of avStates(seconds)){if(!s.fade)continue;c.save();c.translate(s.x,s.y);c.scale(s.dir,1);c.globalAlpha=s.fade;
    c.fillStyle='#071a2a';c.strokeStyle='#528c9b';c.lineWidth=.36;c.beginPath();c.moveTo(-6.5,.4);c.lineTo(-3.1,-1.6);c.lineTo(2.6,-1.9);c.lineTo(6.3,.3);c.lineTo(3.8,1.9);c.lineTo(-3.7,1.8);c.closePath();c.fill();c.stroke();
    c.fillStyle='#427e92';c.beginPath();c.moveTo(-1.5,-1.1);c.lineTo(2,-1.2);c.lineTo(3.6,-.25);c.lineTo(-2.2,-.15);c.closePath();c.fill();
    c.fillStyle='#061524';c.fillRect(-6.8,.7,3,1.4);c.fillRect(3.8,.7,3,1.4);c.fillStyle='#b1e5ed';c.fillRect(5.5,.2,.65,.65);c.fillStyle='#d780a4';c.fillRect(-6.1,.3,.65,.65);c.restore();}
    c.globalAlpha=1;finish(airMask);
  }
  const layers={vapor,flows,traffic,elevators,av};
  return {prepare,layers,trafficStates,elevatorStates,avStates,manifest:()=>({prepared,bounds,maskPixels,airApertures:aperture,facadeVeins:veins.map(v=>({points:v.points,laps:v.laps})),bridges,shafts,rareAVCrossings:scene.blueDistrict.rareAVCrossings,mainGlowModulated:false,cameraMotion:false,trainsRemoved:scene.cityLife.trains.length===0})};
};
