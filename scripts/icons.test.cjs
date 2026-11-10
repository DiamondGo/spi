const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {buildIcons}=require('./icons.cjs')
const desktop=require('../packages/pi-spi/lib/desktop.cjs')
const tmp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'spi-icons-')))
let count=0
function check(name,fn){fn();console.log('PASS',name);count++}
function dimensions(b){assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');return [b.readUInt32BE(16),b.readUInt32BE(20)]}
try{
  const dir=buildIcons(path.join(tmp,'icons')),png=fs.readFileSync(path.join(dir,'icon.png'))
  check('Linux/window PNG is 512x512 and generation is deterministic',()=>{
    assert.deepEqual(dimensions(png),[512,512])
    const other=buildIcons(path.join(tmp,'again'))
    for(const name of ['icon.png','icon.ico','icon.icns'])assert.deepEqual(fs.readFileSync(path.join(dir,name)),fs.readFileSync(path.join(other,name)))
  })
  check('ICO contains all seven correctly offset RGBA PNG resolutions',()=>{
    const b=fs.readFileSync(path.join(dir,'icon.ico')),sizes=[16,24,32,48,64,128,256]
    assert.equal(b.readUInt16LE(2),1);assert.equal(b.readUInt16LE(4),sizes.length)
    let end=6+16*sizes.length
    for(const [i,size]of sizes.entries()){
      const e=6+16*i,length=b.readUInt32LE(e+8),offset=b.readUInt32LE(e+12)
      assert.equal(offset,end);assert.equal(b[e]||256,size);assert.equal(b.readUInt16LE(e+6),32)
      assert.deepEqual(dimensions(b.subarray(offset,offset+length)),[size,size]);end+=length
    }
    assert.equal(end,b.length)
  })
  check('ICNS includes valid PNG chunks through 1024px and Retina variants',()=>{
    const b=fs.readFileSync(path.join(dir,'icon.icns'));assert.equal(b.toString('ascii',0,4),'icns');assert.equal(b.readUInt32BE(4),b.length)
    const expected={icp4:16,icp5:32,icp6:64,ic07:128,ic08:256,ic09:512,ic10:1024,ic11:32,ic12:64,ic13:256,ic14:512};let at=8
    while(at<b.length){const type=b.toString('ascii',at,at+4),len=b.readUInt32BE(at+4);assert.ok(expected[type]);assert.deepEqual(dimensions(b.subarray(at+8,at+len)),[expected[type],expected[type]]);delete expected[type];at+=len}
    assert.equal(at,b.length);assert.deepEqual(expected,{})
  })
  const root=path.join(tmp,'runtime'),entryPath=path.join(root,'releases/0.1.1/linux-x64/app/spi'),icon=path.join(path.dirname(entryPath),'resources/icon.png')
  fs.mkdirSync(path.dirname(icon),{recursive:true});fs.writeFileSync(icon,png)
  const options={enabled:true,root,entryPath,dataHome:path.join(tmp,'data home'),command:path.join(tmp,'bin $`"% back\\slash/spi')}
  let record
  check('desktop entry has the custom icon, correct WM class and escaped Exec',()=>{
    record=desktop.syncDesktopEntry(options)
    const text=fs.readFileSync(record.path,'utf8')
    assert.ok(text.includes('Icon='+icon.replaceAll('\\','\\\\')));assert.ok(text.includes('StartupWMClass=spi'))
    assert.ok(text.includes('%%'));assert.ok(text.includes('\\\\$'));assert.ok(text.includes('\\\\`'));assert.ok(text.includes('\\\\"'))
    assert.equal(desktop.syncDesktopEntry({...options,previous:record}).sha256,record.sha256)
  })
  check('unknown or modified desktop entries are preserved',()=>{
    assert.throws(()=>desktop.syncDesktopEntry(options),/unowned/)
    fs.appendFileSync(record.path,'# user change\n')
    assert.throws(()=>desktop.syncDesktopEntry({...options,previous:record}),/modified/)
    assert.throws(()=>desktop.removeDesktopEntry(record),/modified/)
    assert.ok(fs.readFileSync(record.path,'utf8').includes('user change'))
    fs.writeFileSync(record.path,desktop.desktopText(options.command,icon))
  })
  check('rollback to an old icon-less runtime removes only the owned entry',()=>{
    fs.rmSync(icon)
    assert.equal(desktop.syncDesktopEntry({...options,previous:record}),undefined)
    assert.equal(fs.existsSync(record.path),false)
    assert.equal(desktop.syncDesktopEntry({...options,enabled:false}),undefined)
  })
  check('desktop integration refuses links and control characters',()=>{
    assert.throws(()=>desktop.desktopText('/bad\ncommand',icon),/control/)
    fs.writeFileSync(icon,png)
    const real=path.join(tmp,'foreign');fs.mkdirSync(real)
    const dataHome=path.join(tmp,'linked-data');fs.mkdirSync(dataHome)
    if(process.platform!=='win32'){
      fs.symlinkSync(real,path.join(dataHome,'applications'),'dir')
      assert.throws(()=>desktop.syncDesktopEntry({...options,dataHome}),/symlink/)
      assert.throws(()=>desktop.removeDesktopEntry({path:path.join(dataHome,'applications/spi.desktop'),sha256:'0'.repeat(64)}),/symlink/)
      assert.deepEqual(fs.readdirSync(real),[])
    }
  })
  console.log('RESULT PASS',count,'icon/desktop checks')
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
