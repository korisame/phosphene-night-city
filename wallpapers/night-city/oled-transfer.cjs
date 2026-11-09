// Exact 8-bit transfer of the approved OLED curve, cached for integer RGBA pixels.
const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(10+x*(-15+x*6));};
const base=Uint8Array.from({length:256},(_,v)=>Math.round(255*Math.pow(Math.max(0,v-8)/247,1.20)));
const table=new Uint8Array(256*256);
for(let peak=0;peak<256;peak++){
  const gate=peak<29?ease((peak-15)/14):1;
  for(let v=0;v<256;v++)table[(peak<<8)|v]=Math.round(base[v]*gate);
}
function channel(value,peak){return table[(peak<<8)|value];}
function apply(data){
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],offset=Math.max(r,g,b)<<8;
    data[i]=table[offset|r];data[i+1]=table[offset|g];data[i+2]=table[offset|b];
  }
}
module.exports={apply,channel};
