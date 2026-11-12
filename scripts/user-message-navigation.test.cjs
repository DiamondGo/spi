const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild')
const compiled=esbuild.transformSync(fs.readFileSync(path.join(__dirname,'../src/renderer/src/userMessageNavigation.ts'),'utf8'),{loader:'ts',format:'cjs'})
const mod={exports:{}};new Function('module','exports',compiled.code)(mod,mod.exports)
const {userMessageTargets:targets,userMessageScrollTop:top}=mod.exports
let count=0
function check(name,fn){fn();count++;console.log('PASS',name)}
check('empty/no offscreen questions hide both directions',()=>{
  assert.deepEqual(targets([],0,500),{above:null,below:null})
  assert.deepEqual(targets([16,120,300],0,500),{above:null,below:null})
})
check('the nearest question outside each viewport edge is selected',()=>{
  assert.deepEqual(targets([16,400,1000,1600,2400],800,500),{above:1,below:3})
  assert.deepEqual(targets([16,400,1000,1600,2400],0,500),{above:null,below:2})
  assert.deepEqual(targets([16,400,1000,1600,2400],2500,500),{above:4,below:null})
})
check('aligned questions do not get selected repeatedly; fractional coordinates tolerate layout rounding',()=>{
  assert.deepEqual(targets([16,400,1000,1600],984,500),{above:1,below:3})
  assert.deepEqual(targets([16,400,999.5,1600],984,500),{above:1,below:3})
})
check('visible questions are skipped downward; a partially scrolled long question can be returned to its start',()=>{
  assert.deepEqual(targets([16,550,800],100,500),{above:0,below:2})
  assert.deepEqual(targets([16,110,900],100,500),{above:0,below:2},'a question still visible within the top padding is not an upward target')
  assert.deepEqual(targets([16,1800],700,500),{above:0,below:1})
})
check('resize and expansion recalculate from current geometry rather than stale indexes',()=>{
  assert.deepEqual(targets([16,600,1200],0,500),{above:null,below:1})
  assert.deepEqual(targets([16,600,1200],0,700),{above:null,below:2})
  assert.deepEqual(targets([16,1600,2200],1000,500),{above:0,below:1})
})
check('targets align to padding and clamp to actual scroll boundaries',()=>{
  assert.equal(top(1000,3000,500),984)
  assert.equal(top(5,3000,500),0)
  assert.equal(top(2800,3000,500),2500)
  assert.equal(top(16,100,500),0)
})
check('hidden viewports and invalid coordinates fail safely',()=>{
  assert.deepEqual(targets([16,400],0,0),{above:null,below:null})
  assert.deepEqual(targets([NaN,16,Infinity,900],0,500),{above:null,below:3})
})
console.log('RESULT PASS',count,'user-question navigation checks')
