const linear=Float64Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
const encode=v=>v<=.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-.055;
module.exports=function emission(context,width,height,grade,stride=4){
  const data=context.getImageData(0,0,width,height).data,sum=[0,0,0];let count=0;
  for(let y=0;y<height;y+=stride)for(let x=0;x<width;x+=stride){
    const at=(y*width+x)*4,peak=Math.max(data[at],data[at+1],data[at+2]);
    for(let ch=0;ch<3;ch++)sum[ch]+=linear[grade(data[at+ch],peak)];count++;
  }
  const rgb=sum.map(v=>v/count),luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  const encoded=rgb.map(v=>255*encode(v)),peak=Math.max(...encoded,1);
  return {linearRGB:rgb,linearLuminance:luminance,brightness:encode(luminance),glowColor:encoded.map(v=>Math.round(v/peak*255)).join(','),samples:count,stride};
};
