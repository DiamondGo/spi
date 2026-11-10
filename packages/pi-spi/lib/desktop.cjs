// Linux shell integration for default personal installs only. Never replace unknown/user-modified entries.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function exists(file){try{fs.lstatSync(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
function safeParents(directory){
  for(let dir=directory;;dir=path.dirname(dir)){
    if(exists(dir)&&(!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink()))throw Error('Refusing symlink desktop directory')
    if(dir===path.dirname(dir))break
  }
}
function assertDesktopOwned(record){
  if(!record)return
  if(!path.isAbsolute(record.path)||path.basename(record.path)!=='spi.desktop')throw Error('Invalid desktop entry record')
  safeParents(path.dirname(record.path))
  if(exists(record.path)&&(fs.lstatSync(record.path).isSymbolicLink()||!fs.lstatSync(record.path).isFile()||digest(record.path)!==record.sha256))throw Error('Refusing modified desktop entry')
}
function removeDesktopEntry(record){assertDesktopOwned(record);if(record)fs.rmSync(record.path,{force:true})}
const value=s=>s.replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll('\r','\\r').replaceAll('\t','\\t')
function desktopText(command,icon){
  if(/[\x00-\x1f\x7f]/.test(command+icon))throw Error('Unsupported control character in desktop path')
  // Exec is Desktop Entry syntax, not shell syntax. Then escape the key-file value layer.
  const argument='"'+command.replace(/[\\"`$]/g,'\\$&').replaceAll('%','%%')+'"'
  return '[Desktop Entry]\nType=Application\nName=sPi\nComment=Pi Coding Agent GUI\nExec='+value(argument)+'\nIcon='+value(icon)+'\nTerminal=false\nCategories=Development;\nStartupWMClass=spi\nStartupNotify=true\n'
}
function syncDesktopEntry({enabled,dataHome,root,command,entryPath,previous}){
  if(!enabled)return previous
  const icon=path.join(path.dirname(entryPath),'resources','icon.png')
  if(!exists(icon)){
    // Old releases have no custom icon. A rollback must not leave a stale entry.
    if(previous)removeDesktopEntry(previous)
    return undefined
  }
  if(!path.isAbsolute(dataHome))throw Error('XDG data home must be absolute')
  const directory=path.join(dataHome,'applications'),file=path.join(directory,'spi.desktop')
  safeParents(directory)
  if(exists(file)){
    if(!previous||previous.path!==file)throw Error('Refusing unowned desktop entry')
    assertDesktopOwned(previous)
  }
  if(previous&&previous.path!==file)throw Error('Desktop location changed; existing entry was preserved')
  if(fs.lstatSync(icon).isSymbolicLink()||!fs.lstatSync(icon).isFile()||!fs.realpathSync(icon).startsWith(fs.realpathSync(root)+path.sep))throw Error('Invalid application icon')
  const text=desktopText(command,icon),temp=file+'.'+crypto.randomUUID()+'.tmp'
  fs.mkdirSync(directory,{recursive:true})
  try{fs.writeFileSync(temp,text,{mode:0o644,flag:'wx'});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})}
  return {path:file,sha256:digest(file)}
}
module.exports={syncDesktopEntry,assertDesktopOwned,removeDesktopEntry,desktopText}
