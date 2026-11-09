module.exports=function portraitRig(image,blinkPatch,{createCanvas,D}){
  const W=image.width,H=image.height,pad=24,TAU=Math.PI*2,breathPeriod=D/Math.round(D/6);
  const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(10+x*(-15+x*6));};
  const source=createCanvas(W,H),sc=source.getContext('2d');sc.drawImage(image,0,0);
  const pixels=sc.getImageData(0,0,W,H).data;
  const layers=Array.from({length:3},()=>createCanvas(W,H)),contexts=layers.map(x=>x.getContext('2d')),data=contexts.map(c=>c.createImageData(W,H));
  for(let y=0;y<H;y++){
    const u=y/H,head=1-ease((u-.335)/.075),body=(1-head)*(1-ease((u-.72)/.14));
    for(let x=0;x<W;x++){
      const at=(y*W+x)*4,alpha=pixels[at+3],a=Math.round(alpha*head),b=Math.min(alpha-a,Math.round(alpha*body));
      const weights=[a,b,alpha-a-b];for(let k=0;k<3;k++){for(let ch=0;ch<3;ch++)data[k].data[at+ch]=pixels[at+ch];data[k].data[at+3]=weights[k];}
    }
  }
  contexts.forEach((c,i)=>c.putImageData(data[i],0,0));
  const output=createCanvas(W+pad*2,H+pad*2),ctx=output.getContext('2d');
  function pose(time,blink=0){
    const t=((time%D)+D)%D,p=t/D*TAU,u=(t%breathPeriod)/breathPeriod;
    const breath=u<.36?ease(u/.36):1-ease((u-.36)/.60);
    const lift=1.8*breath,torso=.15*Math.PI/180*Math.sin(p*2),head=.42*Math.PI/180*(Math.sin(p*3+.3)-Math.sin(.3));
    const hip={x:W*.51,y:H*.78},neck={x:W*.50,y:H*.385};
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,output.width,output.height);ctx.globalAlpha=1;ctx.globalCompositeOperation='lighter';
    ctx.save();ctx.translate(pad,pad);ctx.drawImage(layers[2],0,0);ctx.translate(hip.x,hip.y-lift);ctx.rotate(torso);ctx.translate(-hip.x,-hip.y);ctx.drawImage(layers[1],0,0);
    ctx.translate(neck.x,neck.y);ctx.rotate(head);ctx.translate(-neck.x,-neck.y);ctx.drawImage(layers[0],0,0);
    if(blink>0){ctx.globalCompositeOperation='source-over';ctx.globalAlpha=blink;ctx.drawImage(blinkPatch,340,275);}
    ctx.restore();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    return output;
  }
  return {pose,padding:pad,width:W,height:H,manifest:{rigidHeadAndTorso:true,horizontalStripWarping:false,widthScaling:false,breathingPeriodSeconds:breathPeriod,maximumLiftSourcePixels:1.8,lowerBodyAnchored:true}};
};
