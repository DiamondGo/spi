// Original SVG is the only artwork source. Generated platform assets are not committed.
const fs=require('node:fs'),path=require('node:path')
const {Resvg}=require('@resvg/resvg-js')
const root=path.resolve(__dirname,'..')
function buildIcons(output=path.join(root,'build/icons')){
  const svg=fs.readFileSync(path.join(root,'resources/icon.svg'))
  const png=new Map()
  const render=size=>{if(!png.has(size))png.set(size,new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng());return png.get(size)}
  fs.mkdirSync(output,{recursive:true})
  fs.writeFileSync(path.join(output,'icon.png'),render(512))
  const sizes=[16,24,32,48,64,128,256],header=Buffer.alloc(6+16*sizes.length)
  header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4)
  let offset=header.length
  const images=sizes.map((size,i)=>{
    const data=render(size),entry=6+i*16
    header[entry]=header[entry+1]=size===256?0:size
    header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6)
    header.writeUInt32LE(data.length,entry+8);header.writeUInt32LE(offset,entry+12)
    offset+=data.length;return data
  })
  fs.writeFileSync(path.join(output,'icon.ico'),Buffer.concat([header,...images]))
  const chunks=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]].map(([type,size])=>{
    const data=render(size),chunk=Buffer.alloc(8)
    chunk.write(type,0,4,'ascii');chunk.writeUInt32BE(8+data.length,4)
    return Buffer.concat([chunk,data])
  })
  const icns=Buffer.alloc(8);icns.write('icns',0,4,'ascii');icns.writeUInt32BE(8+chunks.reduce((n,b)=>n+b.length,0),4)
  fs.writeFileSync(path.join(output,'icon.icns'),Buffer.concat([icns,...chunks]))
  return output
}
module.exports={buildIcons}
if(require.main===module){buildIcons();console.log('Generated original spy icon: PNG, multi-size ICO and ICNS')}
