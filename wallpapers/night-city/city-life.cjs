const {createCanvas}=require('@napi-rs/canvas');
const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>{x=clamp(x);return x*x*x*(10+x*(-15+x*6));};
const mod=(x,n)=>(x%n+n)%n;
function event(t,start,rise,hold,fall){const a=t-start;return a<=0||a>=rise+hold+fall?0:a<rise?ease(a/rise):a<rise+hold?1:1-ease((a-rise-hold)/fall);}
module.exports=function(ctx,{W,H,AW,AH,D,scene,polygon,skyline,glow}){
  const SX=W/AW,SY=H/AH;
  const rooms=[{x:200,y:646,w:17,h:20,start:18,duration:15,blind:67},{x:200,y:723,w:17,h:20,start:52,duration:17,blind:96},{x:355,y:712,w:17,h:18,start:94,duration:16,blind:36}];
  const fans=[{x:115,y:821,r:7.5,laps:17},{x:142,y:847,r:4.8,laps:-13}];
  const cables=[{a:[378,690],b:[398,738],sag:17,phase:.3},{a:[903,661],b:[916,706],sag:14,phase:2.1}];
  const headlightPasses=[{start:36,duration:15,from:155,to:1300},{start:97,duration:17,from:1500,to:400}];
  const lightsCanvas=createCanvas(W,H),lc=lightsCanvas.getContext('2d');
  let wetMask,railMask,prepared=false;
  function prepare(image){
    const source=createCanvas(W,H),sc=source.getContext('2d');sc.drawImage(image,0,0,W,H);const pixels=sc.getImageData(0,0,W,H).data;
    for(const room of rooms){
      const width=Math.ceil(room.w*SX),height=Math.ceil(room.h*SY);room.mask=createCanvas(width,height);const x=room.mask.getContext('2d'),m=x.createImageData(width,height);let count=0;
      for(let y=0;y<height;y++)for(let xx=0;xx<width;xx++){
        const at=(Math.floor(room.y*SY+y)*W+Math.floor(room.x*SX+xx))*4,i=(y*width+xx)*4;
        if(pixels[at]>130&&pixels[at+1]>85&&pixels[at+2]<pixels[at+1]*.94){m.data[i]=m.data[i+1]=m.data[i+2]=255;m.data[i+3]=255;count++;}
      }
      if(count<45)throw Error('Room did not match lit glass: '+JSON.stringify(room));
      x.putImageData(m,0,0);room.glassPixels=count;room.canvas=createCanvas(width,height);room.c=room.canvas.getContext('2d');
    }
    wetMask=createCanvas(W,H);railMask=createCanvas(W,H);const wc=wetMask.getContext('2d'),rc=railMask.getContext('2d'),wm=wc.createImageData(W,H),rm=rc.createImageData(W,H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=(y*W+x)*4,ax=x/SX,ay=y/SY,peak=Math.max(pixels[i],pixels[i+1],pixels[i+2]);
      const wet=ay>864&&peak>48;
      const railY=706-84*ax/AW,rail=Math.abs(ay-railY)<7&&peak>75;
      if(wet){wm.data[i]=wm.data[i+1]=wm.data[i+2]=255;wm.data[i+3]=Math.round(Math.min(1,(peak-35)/100)*220);}
      if(rail){rm.data[i]=rm.data[i+1]=rm.data[i+2]=255;rm.data[i+3]=230;}
    }
    wc.putImageData(wm,0,0);rc.putImageData(rm,0,0);prepared=true;
  }
  const bez=(a,b,c,d,u)=>{const v=1-u;return [v*v*v*a[0]+3*v*v*u*b[0]+3*v*u*u*c[0]+u*u*u*d[0],v*v*v*a[1]+3*v*v*u*b[1]+3*v*u*u*c[1]+u*u*u*d[1]];};
  function droneStates(seconds){
    const t=mod(seconds,D),out=[];
    if(t>44&&t<79){
      let position,stage;
      if(t<60){position=bez([250,310],[415,325],[574,378],[575,433],ease((t-44)/16));stage='braking approach';}
      else if(t<64){position=[575,433+7*ease((t-60)/4)];stage='landing';}
      else if(t<69){position=[575,440];stage='landed';}
      else {position=bez([575,440],[574,397],[440,263],[325,267],ease((t-69)/10));stage='departure';}
      out.push({id:'roof courier',x:position[0],y:position[1],z:1,fade:ease((t-44)/2)*ease((79-t)/2),stage});
    }
    if(t>82&&t<108){const u=ease((t-82)/26),position=bez([115,200],[232,157],[423,190],[635,162],u);out.push({id:'upper courier',x:position[0],y:position[1],z:.68,fade:ease((t-82)/2)*ease((108-t)/2),stage:'cruise'});}
    return out;
  }
  function drones(seconds){
    const t=mod(seconds,D);ctx.save();ctx.globalCompositeOperation='source-over';
    // A small metal pad rests on the inspected lower rooftop, with its underside on the roof.
    ctx.save();ctx.scale(SX,SY);ctx.fillStyle='#152630';ctx.strokeStyle='#6b9aa5';ctx.lineWidth=.55;
    ctx.beginPath();ctx.moveTo(564,444);ctx.lineTo(585,442);ctx.lineTo(592,446);ctx.lineTo(571,449);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#0b1823';ctx.fillRect(572,448,3,2);ctx.fillRect(585,446,2,2);ctx.strokeStyle='#689caf';ctx.lineWidth=.5;ctx.beginPath();ctx.ellipse(578,445.5,5,1.3,-.08,0,TAU);ctx.stroke();ctx.restore();
    // Both routes were fitted to actual empty sky and the pad, rather than the older coarse skyline mask.
    ctx.beginPath();ctx.rect(0,0,700*SX,500*SY);ctx.clip();
    for(const s of droneStates(t)){
      const landing=s.stage==='landing'||s.stage==='landed';ctx.save();ctx.translate(s.x*SX,s.y*SY);ctx.scale(SX*s.z,SY*s.z);ctx.globalAlpha=s.fade;
      ctx.strokeStyle='#557984';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-9,0);ctx.lineTo(9,0);ctx.stroke();
      ctx.fillStyle='#11202c';ctx.beginPath();ctx.roundRect(-4,-2.6,8,4.4,.8);ctx.fill();ctx.strokeStyle='#7fa4ad';ctx.lineWidth=.5;ctx.stroke();
      ctx.fillStyle='#283646';ctx.fillRect(-2.8,1.3,5.6,2.7);ctx.fillStyle='#d5ad68';ctx.fillRect(-1.7,2,2,.8);
      ctx.strokeStyle='#8aafb9';ctx.lineWidth=.5;for(const x of [-8,8]){ctx.beginPath();ctx.ellipse(x,-.5,3,.75,0,0,TAU);ctx.stroke();}
      ctx.fillStyle=landing?'#ffd496':'#a8ecfa';ctx.fillRect(-9.2,-1.4,1.5,1.2);ctx.fillStyle='#e190a4';ctx.fillRect(8,-1.4,1.3,1.2);
      if(landing){ctx.globalCompositeOperation='screen';const beam=ctx.createLinearGradient(0,2,0,9);beam.addColorStop(0,'rgba(203,225,237,.12)');beam.addColorStop(1,'rgba(203,225,237,0)');ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(-1,2);ctx.lineTo(4,9);ctx.lineTo(-4,9);ctx.closePath();ctx.fill();}
      ctx.restore();
    }
    ctx.restore();
    if(t>59&&t<73){const a=event(t,59,3,7,4);glow(ctx,575*SX,445*SY,10*SX,2*SY,'186,222,229',a*.16);}
  }
  function windowLife(seconds){
    const t=mod(seconds,D);ctx.save();ctx.globalCompositeOperation='source-over';for(const [index,r]of rooms.entries()){
      const c=r.c;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,r.canvas.width,r.canvas.height);c.save();c.scale(SX,SY);
      const u=(t-r.start)/r.duration;
      if(u>0&&u<1){const x=-3+u*(r.w+6),fade=ease(u/.12)*ease((1-u)/.12),walk=Math.sin(u*TAU*6),y=r.h-1;
        c.globalAlpha=fade*.94;c.fillStyle='#1a161e';c.beginPath();c.arc(x,y-9,1.35,0,TAU);c.fill();
        c.beginPath();c.moveTo(x-1.3,y-7.2);c.quadraticCurveTo(x,y-8.1,x+1.5,y-6.8);c.lineTo(x+1.7,y-2.7);c.lineTo(x-1.6,y-2.7);c.closePath();c.fill();
        c.strokeStyle='#1a161e';c.lineWidth=.85;c.lineCap='round';c.beginPath();c.moveTo(x-.7,y-3);c.lineTo(x-1.2-walk*.6,y);c.moveTo(x+.7,y-3);c.lineTo(x+1+walk*.6,y);c.moveTo(x-1,y-6);c.lineTo(x-2.4-walk*.35,y-3.5);c.moveTo(x+1,y-6);c.lineTo(x+2.1+walk*.35,y-3.7);c.stroke();
      }
      const closed=event(t,r.blind,5,13,6);if(closed>0){c.globalAlpha=.84;c.fillStyle='#282332';c.fillRect(0,0,r.w,r.h*closed);c.globalAlpha=.65;c.strokeStyle='#a68973';c.lineWidth=.4;for(let y=1;y<r.h*closed;y+=1.65){c.beginPath();c.moveTo(0,y);c.lineTo(r.w,y);c.stroke();}}
      c.restore();c.globalAlpha=1;c.globalCompositeOperation='destination-in';c.drawImage(r.mask,0,0);c.globalCompositeOperation='source-over';ctx.drawImage(r.canvas,r.x*SX,r.y*SY);
    }
    // The glass shaft exists in the artwork. A single car light travels within it.
    const u=mod(t/D*4+.22,1),y=552+u*43,fade=Math.min(1,u*12,(1-u)*12);
    ctx.save();ctx.beginPath();ctx.rect(1007*SX,552*SY,8*SX,43*SY);ctx.clip();ctx.globalCompositeOperation='screen';
    glow(ctx,1011*SX,y*SY,4*SX,5*SY,'227,255,219',.24*fade);ctx.fillStyle=`rgba(207,243,211,${.44*fade})`;ctx.fillRect(1008*SX,y*SY,6*SX,1.6*SY);ctx.restore();ctx.restore();
  }
  function trafficState(seconds){const t=mod(seconds,D);return headlightPasses.map(e=>{const u=(t-e.start)/e.duration;return {u,x:e.from+(e.to-e.from)*ease(u),power:u>0&&u<1?ease(u/.18)*ease((1-u)/.18):0};});}
  function reflections(seconds){
    const t=mod(seconds,D),p=t/D*TAU,active=trafficState(t).filter(e=>e.power>0);if(!active.length)return;
    const floorY=Math.floor(864*SY),floorH=H-floorY,railY=Math.floor(620*SY),railH=Math.ceil(94*SY);
    lc.setTransform(1,0,0,1,0,0);lc.save();lc.beginPath();lc.rect(0,floorY,W,floorH);lc.clip();lc.clearRect(0,floorY,W,floorH);lc.globalCompositeOperation='source-over';
    for(const e of active){
      // An offscreen nearby service road supplies the travelling pool of headlight.
      for(let y=872;y<938;y+=2.2){const depth=(y-872)/66,width=(24+depth*105)*SX,shift=Math.sin(y*.77+p*11)*4*SX;
        const alpha=e.power*(.135+.075*depth)*Math.sin((y-872)/66*Math.PI);
        glow(lc,e.x*SX+shift,y*SY,width,.8*SY,'212,230,233',alpha);
      }
    }
    lc.globalCompositeOperation='destination-in';lc.drawImage(wetMask,0,0);lc.restore();ctx.save();ctx.globalCompositeOperation='screen';ctx.drawImage(lightsCanvas,0,floorY,W,floorH,0,floorY,W,floorH);ctx.restore();
    lc.save();lc.beginPath();lc.rect(0,railY,W,railH);lc.clip();lc.clearRect(0,railY,W,railH);lc.globalCompositeOperation='source-over';
    for(const e of active){const y=706-84*e.x/AW;glow(lc,e.x*SX,y*SY,66*SX,4*SY,'193,229,240',.26*e.power);}
    lc.globalCompositeOperation='destination-in';lc.drawImage(railMask,0,0);lc.restore();ctx.save();ctx.globalCompositeOperation='screen';ctx.drawImage(lightsCanvas,0,railY,W,railH,0,railY,W,railH);ctx.restore();
  }
  function foreground(seconds,wind=0){
    const p=mod(seconds,D)/D*TAU;ctx.save();ctx.globalCompositeOperation='source-over';ctx.scale(SX,SY);ctx.lineCap='round';
    for(const [i,c]of cables.entries()){
      const sway=1.6*Math.sin(p*(3+i)+c.phase)+wind*1.4;
      const line=()=>{ctx.beginPath();ctx.moveTo(...c.a);ctx.bezierCurveTo(c.a[0]-c.sag+sway,c.a[1]+16,c.b[0]-c.sag+sway,c.b[1]+8,...c.b);};
      line();ctx.strokeStyle='#030a13';ctx.lineWidth=2.5;ctx.stroke();line();ctx.strokeStyle='#386879';ctx.lineWidth=.65;ctx.stroke();
      for(const [x,y]of [c.a,c.b]){ctx.fillStyle='#7695a0';ctx.fillRect(x-1.6,y-1,3.2,2);ctx.fillStyle='#0a1420';ctx.fillRect(x-.5,y-.5,1,1);}
    }
    for(const f of fans){
      ctx.save();ctx.translate(f.x,f.y);ctx.scale(1,1.08);
      ctx.fillStyle='#101824';ctx.strokeStyle='#6c7272';ctx.lineWidth=.65;ctx.beginPath();ctx.arc(0,0,f.r+1.8,0,TAU);ctx.fill();ctx.stroke();
      ctx.fillStyle='#050c15';ctx.beginPath();ctx.arc(0,0,f.r,0,TAU);ctx.fill();
      ctx.save();ctx.rotate(p*f.laps);for(let i=0;i<5;i++){ctx.rotate(TAU/5);ctx.fillStyle=i%2?'#38515b':'#53646b';ctx.beginPath();ctx.moveTo(0,0);ctx.bezierCurveTo(f.r*.25,-f.r*.75,f.r*.9,-f.r*.65,f.r*.85,-f.r*.1);ctx.quadraticCurveTo(f.r*.40,f.r*.13,0,0);ctx.fill();}ctx.restore();
      ctx.strokeStyle='#243240';ctx.lineWidth=.65;for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(-f.r*.91,i*f.r*.3);ctx.lineTo(f.r*.91,i*f.r*.3);ctx.stroke();}
      ctx.fillStyle='#758792';ctx.beginPath();ctx.arc(0,0,1.2,0,TAU);ctx.fill();
      for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){ctx.fillStyle='#a09c89';ctx.beginPath();ctx.arc(Math.cos(angle)*(f.r+1.1),Math.sin(angle)*(f.r+1.1),.45,0,TAU);ctx.fill();}
      ctx.restore();
    }
    ctx.restore();
  }
  function glance(seconds){const t=mod(seconds,D);return scene.cityLife.glances.reduce((n,e)=>n+e.degrees*event(t,e.start,e.rise,e.hold,e.fall),0);}
  const layers={drones,windows:windowLife,reflections,foreground};
  return {prepare,drones,windows:windowLife,reflections,foreground,glance,droneStates,trafficState,layers,
    manifest:()=>({elevatedTrains:[],carriagesPerTrain:0,trainLightOnNearbyFacades:false,trainsRemoved:true,courierDrones:2,landingAndBraking:true,landingRoof:[575,445],rooms:rooms.map(({x,y,w,h,glassPixels,start,duration,blind})=>({x,y,w,h,glassPixels,start,duration,blind})),glassMasksPreserveMullions:true,elevatorShaft:[1007,552,8,43],headlightPasses,headlightSource:'nearby offscreen service traffic',wetAndRailSourcePixelMasks:true,foregroundCables:cables.length,ventilationFans:fans,glances:scene.cityLife.glances,rigidHead:true,cameraMotion:false,prepared})};
};
