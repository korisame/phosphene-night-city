const {createCanvas}=require('@napi-rs/canvas');
const TAU=Math.PI*2,mod=(x,n)=>(x%n+n)%n;
const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(10+x*(-15+6*x));};
function pulse(t,start,duration){const u=(t-start)/duration;return u<=0||u>=1?0:Math.sin(Math.PI*u)**4;}
module.exports=function(ctx,{W,H,AW,AH,D,scene,polygon,skyline}){
  const sx=W/AW,sy=H/AH;
  function state(seconds){
    const t=mod(seconds,D),p=t/D*TAU;
    const gust=scene.weather.gusts.reduce((v,[s,d,g])=>v+g*pulse(t,s,d),0);
    return {t,rain:.62+.82*(.5+.5*Math.sin(p-.85)),wind:.35*Math.sin(p)+gust,
      gust,fog:.74+.26*(.5+.5*Math.sin(p-1.8))};
  }
  let seed=876321;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  // Soft procedural wisps add moving weather; the approved skyline/plate never transforms.
  const cloud=createCanvas(512,176),c=cloud.getContext('2d');
  for(let i=0;i<38;i++){
    const x=50+rnd()*412,y=66+rnd()*45,rx=22+rnd()*55;
    c.save();c.translate(x,y);c.scale(1,.35+rnd()*.27);
    const g=c.createRadialGradient(0,0,0,0,0,rx);g.addColorStop(0,'rgba(72,117,160,.30)');g.addColorStop(.45,'rgba(35,67,104,.18)');g.addColorStop(1,'rgba(16,27,45,0)');
    c.fillStyle=g;c.fillRect(-rx,-rx,rx*2,rx*2);c.restore();
  }
  const wisps=Array.from({length:18},(_,i)=>({phase:rnd(),y:45+rnd()*325,width:190+rnd()*245,height:36+rnd()*62,layer:i%2,gain:.12+rnd()*.20}));
  function sky(seconds){
    const s=state(seconds),p=s.t/D*TAU;
    ctx.save();polygon(ctx,skyline,sx,sy);ctx.clip();ctx.globalCompositeOperation='source-over';
    for(const w of wisps){
      const u=mod(w.phase+s.t/D*(w.layer?2:1),1),fade=Math.min(1,u*9,(1-u)*9);
      const x=(u*1100-220+(w.layer?13:7)*Math.sin(p))*sx,y=(w.y+3*Math.sin(p+w.phase*TAU))*sy;
      ctx.globalAlpha=w.gain*fade*s.fog;ctx.drawImage(cloud,x,y,w.width*sx,w.height*sy);
    }
    ctx.restore();
  }
  function searchlight(seconds){
    const t=mod(seconds,D),e=scene.cityEvents.searchlight,u=(t-e.start)/e.duration;
    if(u<=0||u>=1)return;
    const fade=ease(u/.16)*ease((1-u)/.20),angle=-2.24+.42*ease(u),length=440*sx;
    const ox=715*sx,oy=306*sy,dx=Math.cos(angle),dy=Math.sin(angle),nx=-dy,ny=dx;
    ctx.save();polygon(ctx,skyline,sx,sy);ctx.clip();ctx.globalCompositeOperation='screen';
    // Angular feathering prevents a hard triangle in the near-black sky.
    for(let i=0;i<32;i++){
      const v=(i+.5)/32*2-1,gain=Math.exp(-v*v*5.5)*.075*fade;
      const a0=angle+(i/32*2-1)*.095,a1=angle+((i+1)/32*2-1)*.095;
      const gradient=ctx.createLinearGradient(ox,oy,ox+dx*length,oy+dy*length);
      gradient.addColorStop(0,`rgba(137,209,237,${gain})`);gradient.addColorStop(.42,`rgba(112,171,199,${gain*.64})`);gradient.addColorStop(1,'rgba(87,136,173,0)');
      ctx.fillStyle=gradient;ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox+Math.cos(a0)*length,oy+Math.sin(a0)*length);ctx.lineTo(ox+Math.cos(a1)*length,oy+Math.sin(a1)*length);ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }
  function adMix(seconds){const t=mod(seconds,D),e=scene.cityEvents.upperAdChange,a=t-e.start;return a<0||a>=e.rise+e.hold+e.fall?0:a<e.rise?ease(a/e.rise):a<e.rise+e.hold?1:1-ease((a-e.rise-e.hold)/e.fall);}
  return {state,sky,searchlight,adMix,manifest:{rainIntensityRange:scene.weather.rainIntensity,gusts:scene.weather.gusts,cloudLayers:2,movingWisps:wisps.length,skylineOcclusion:true,searchlight:scene.cityEvents.searchlight,adChange:scene.cityEvents.upperAdChange,cameraMovement:false,lightning:false}};
};
