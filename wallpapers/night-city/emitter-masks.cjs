module.exports=function detectApartments(source,{AW,AH,createCanvas,pointInQuad,screens}){
  const W=source.width,H=source.height,SX=W/AW,SY=H/AH;
  const pixels=source.getContext('2d').getImageData(0,0,W,H).data;
  const warm=new Uint8Array(W*H),seen=new Uint8Array(W*H),windows=[];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const ax=(x+.5)/SX-.5,ay=(y+.5)/SY-.5,at=(y*W+x)*4;
    if(ay<=145||ay>=866||ay>892-108*ax/AW||(ax<130&&ay>785))continue;
    const r=pixels[at],g=pixels[at+1],b=pixels[at+2];
    if(r>138&&g>78&&g<r*.90&&b<g*.80&&!screens.some(s=>pointInQuad(ax,ay,s.quad))&&!(ax<560&&ay<530&&ax>130))warm[y*W+x]=1;
  }
  for(let id=0;id<warm.length;id++){
    if(!warm[id]||seen[id])continue;
    const cells=[],queue=[id];seen[id]=1;let minX=W,minY=H,maxX=0,maxY=0;
    for(let k=0;k<queue.length;k++){
      const at=queue[k],x=at%W,y=Math.floor(at/W);cells.push(at);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const offset of [-W,W,-1,1]){
        const next=at+offset;
        if(next<0||next>=warm.length||(offset===-1&&x===0)||(offset===1&&x===W-1))continue;
        if(warm[next]&&!seen[next]){seen[next]=1;queue.push(next);}
      }
    }
    const width=maxX-minX+1,height=maxY-minY+1;
    if(cells.length<2*SX*SY||cells.length>110*SX*SY||width>13*SX||height>20*SY||cells.length/(width*height)<.26)continue;
    const pad=Math.ceil(5*Math.max(SX,SY));
    const core=createCanvas(width+pad*2,height+pad*2),cc=core.getContext('2d'),ci=cc.createImageData(core.width,core.height);
    const dark=createCanvas(core.width,core.height),dc=dark.getContext('2d'),di=dc.createImageData(core.width,core.height);
    const light=createCanvas(core.width,core.height),lc=light.getContext('2d');
    for(const at of cells){
      const original=at*4,target=((Math.floor(at/W)-minY+pad)*core.width+at%W-minX+pad)*4;
      ci.data[target]=pixels[original];ci.data[target+1]=pixels[original+1];ci.data[target+2]=pixels[original+2];ci.data[target+3]=Math.min(255,(pixels[original]-100)*2);
      di.data[target]=12+pixels[original+2]*.08;di.data[target+1]=18+pixels[original+1]*.08;di.data[target+2]=30+pixels[original+2]*.10;di.data[target+3]=255;
    }
    cc.putImageData(ci,0,0);dc.putImageData(di,0,0);lc.filter=`blur(${2.4*Math.max(SX,SY)}px)`;lc.globalAlpha=.55;lc.drawImage(core,0,0);lc.filter='none';lc.globalAlpha=1;lc.drawImage(core,0,0);
    windows.push({x:(minX-pad)/SX,y:(minY-pad)/SY,cx:(minX+maxX)/2/SX,cy:(minY+maxY)/2/SY,light,dark,pixelScaleX:SX,pixelScaleY:SY,
      samplePoints:cells.map(at=>[((at%W)+.5)/SX-.5,(Math.floor(at/W)+.5)/SY-.5])});
  }
  return windows;
};
