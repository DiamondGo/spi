const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),asar=require('@electron/asar')
const {evaluateAudit,checkInputs,scanRuntime,validateInventory}=require('./security-policy.cjs')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-security-policy-'));let count=0
const leaf={name:'picomatch',dependency:'picomatch',severity:'high',url:'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',range:'<=4.0.7'}
function fixture(){return{audit:{auditReportVersion:2,metadata:{vulnerabilities:{high:2,critical:0}},vulnerabilities:{picomatch:{severity:'high',nodes:['node_modules/picomatch'],via:[{...leaf}]},vite:{severity:'high',nodes:['node_modules/vite'],via:['picomatch']}}},lock:{packages:{'node_modules/picomatch':{dev:true},'node_modules/vite':{dev:true}}}}}
async function test(name,fn){await fn();count++;console.log('PASS',name)}
async function runtime(files={},pkg={version:'0.3.5'},helper='// installer'){
 const folder=fs.mkdtempSync(path.join(tmp,'runtime-')),source=path.join(folder,'source'),resources=path.join(folder,'resources');fs.mkdirSync(source);fs.mkdirSync(resources)
 for(const [file,text]of Object.entries({'package.json':JSON.stringify(pkg),'out/index.js':'console.log("safe")',...files})){const dest=path.join(source,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text)}
 await asar.createPackage(source,path.join(resources,'app.asar'));fs.writeFileSync(path.join(resources,'spi-installer.cjs'),helper);return resources
}
;(async()=>{try{
 await test('high findings block every version now that the withdrawn-advisory exception is retired',()=>{
  const {audit,lock}=fixture()
  for(const version of ['0.3.3','0.3.4','0.3.5','1.0.0'])assert.throws(()=>evaluateAudit(audit,lock,version),/Unapproved high audit findings/)
  const clean={auditReportVersion:2,metadata:{vulnerabilities:{high:0,critical:0}},vulnerabilities:{}}
  const report=evaluateAudit(clean,lock,'0.3.5')
  assert.equal(report.exceptionUsed,false);assert.deepEqual(report.acceptedAdvisories,[])
 })
 await test('critical findings and mismatched severity counts always block',()=>{
  const x=fixture();x.audit.metadata.vulnerabilities.critical=1;x.audit.metadata.vulnerabilities.high=0;x.audit.vulnerabilities={picomatch:{severity:'critical',nodes:[],via:[]}}
  assert.throws(()=>evaluateAudit(x.audit,x.lock,'0.3.5'),/critical/)
  const y=fixture();y.audit.metadata.vulnerabilities.high=1
  assert.throws(()=>evaluateAudit(y.audit,y.lock,'0.3.5'),/counts do not match/)
 })
 await test('every high finding is named in the block, not hidden behind another leaf',()=>{
  const {audit,lock}=fixture();audit.vulnerabilities.picomatch.via.push({...leaf,url:'https://github.com/advisories/GHSA-new'})
  assert.throws(()=>evaluateAudit(audit,lock,'0.3.5'),/picomatch; vite/)
 })
 await test('malformed, unavailable or unresolved audit results fail closed',()=>{
  for(const change of [x=>{x.audit.error={code:'ENETUNREACH'}},x=>{delete x.audit.metadata},x=>{x.audit.auditReportVersion=1},x=>{x.audit.vulnerabilities={}},x=>{x.audit.metadata.vulnerabilities.high=0}]){const x=fixture();change(x);assert.throws(()=>evaluateAudit(x.audit,x.lock,'0.3.5'))}
 })
 await test('clean and moderate-only audits pass without pretending an exception was used',()=>{
  const {audit,lock}=fixture();audit.vulnerabilities={uuid:{severity:'moderate',nodes:[],via:[]}};audit.metadata.vulnerabilities={high:0,critical:0}
  const report=evaluateAudit(audit,lock,'0.3.5');assert.equal(report.exceptionUsed,false);assert.equal(report.reportedCounts.high,0)
 })
 await test('standalone installer build inputs cannot include build-only matching modules',()=>{
  checkInputs({'packages/pi-spi/lib/installer.cjs':{},'node_modules/tar/index.js':{}})
  for(const file of ['node_modules/picomatch/index.js','node_modules/fdir/index.js','node_modules/node-gyp/bin.js','node_modules/@electron/rebuild/index.js','x/node_modules/tinyglobby/index.js'])assert.throws(()=>checkInputs({[file]:{}}),/Build-only/)
 })
 await test('real ASAR and standalone installer inventory binds version and both content hashes',async()=>{
  const resources=await runtime(),report=scanRuntime(resources,'0.3.5');assert.equal(report.policy,'no-build-dependencies');assert.equal(report.forbiddenModulesAbsent,true);assert.equal(report.scriptsScanned,2);validateInventory(report,'0.3.5',report.installerSha256)
  for(const patch of [{version:'0.3.4'},{policy:'any'},{forbiddenModulesAbsent:false},{scriptsScanned:0},{asarSha256:'invalid'},{installerSha256:'0'.repeat(64)}])assert.throws(()=>validateInventory({...report,...patch},'0.3.5',report.installerSha256))
 })
 await test('runtime inventory policy is no-build-dependencies for every version and rejects cross-version metadata',async()=>{
  for(const version of ['0.3.3','0.3.4','0.3.5']){const report=scanRuntime(await runtime({},{version}),version);assert.equal(report.policy,'no-build-dependencies');validateInventory(report,version,report.installerSha256)}
  const report=scanRuntime(await runtime({},{version:'0.3.5'}),'0.3.5')
  assert.throws(()=>validateInventory(report,'0.3.4',report.installerSha256))
 })
 await test('actual forbidden modules or bundled picomatch code fail the runtime inventory',async()=>{
  for(const files of [{'node_modules/picomatch/index.js':'safe'},{'node_modules/fdir/package.json':'{}'},{'out/index.js':'function analyzeRepeatedExtglob() {}'},{'out/index.js':'require("picomatch")'}]){const resources=await runtime(files);assert.throws(()=>scanRuntime(resources,'0.3.5'),/Build-only|Picomatch/)}
  for(const [file,text]of [['app.asar.unpacked/node_modules/picomatch/index.js','safe'],['app.asar.unpacked/extra.js','analyzeRepeatedExtglob']]){const resources=await runtime(),target=path.join(resources,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);assert.throws(()=>scanRuntime(resources,'0.3.5'),/Build-only|Picomatch/)}
  assert.throws(()=>scanRuntime('missing','0.3.5'))
 })
 await test('version drift, dev declarations and vulnerable code in the helper fail closed',async()=>{
  for(const [pkg,helper]of [[{version:'0.3.4'},'safe'],[{version:'0.3.5',devDependencies:{vite:'*'}},'safe'],[{version:'0.3.5'},'analyzeRepeatedExtglob']]){const resources=await runtime({},pkg,helper);assert.throws(()=>scanRuntime(resources,'0.3.5'))}
 })
 console.log('RESULT PASS',count,'scoped security-policy checks')
}finally{fs.rmSync(tmp,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1})
