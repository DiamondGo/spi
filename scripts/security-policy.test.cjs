const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),asar=require('@electron/asar')
const {ADVISORY,evaluateAudit,checkInputs,scanRuntime,validateInventory}=require('./security-policy.cjs')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-security-policy-'));let count=0
const leaf={name:'picomatch',dependency:'picomatch',severity:'high',url:ADVISORY,range:'<=4.0.7'}
function fixture(){return{audit:{auditReportVersion:2,metadata:{vulnerabilities:{high:2,critical:0}},vulnerabilities:{picomatch:{severity:'high',nodes:['node_modules/picomatch'],via:[{...leaf}]},vite:{severity:'high',nodes:['node_modules/vite'],via:['picomatch']}}},lock:{packages:{'node_modules/picomatch':{dev:true},'node_modules/vite':{dev:true}}}}}
async function test(name,fn){await fn();count++;console.log('PASS',name)}
async function runtime(files={},pkg={version:'0.3.3'},helper='// installer'){
 const folder=fs.mkdtempSync(path.join(tmp,'runtime-')),source=path.join(folder,'source'),resources=path.join(folder,'resources');fs.mkdirSync(source);fs.mkdirSync(resources)
 for(const [file,text]of Object.entries({'package.json':JSON.stringify(pkg),'out/index.js':'console.log("safe")',...files})){const dest=path.join(source,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text)}
 await asar.createPackage(source,path.join(resources,'app.asar'));fs.writeFileSync(path.join(resources,'spi-installer.cjs'),helper);return resources
}
;(async()=>{try{
 await test('only explicitly approved 0.3.3/0.3.4 build advisory and inherited dev-only findings are allowed',()=>{
  const {audit,lock}=fixture(),report=evaluateAudit(audit,lock,'0.3.3');assert.equal(report.exceptionUsed,true);assert.deepEqual(report.acceptedAdvisories,[ADVISORY]);assert.equal(report.reportedCounts.high,2)
  assert.equal(evaluateAudit(audit,lock,'0.3.4').exceptionUsed,true)
  for(const version of ['0.3.2','0.3.5','1.0.0'])assert.throws(()=>evaluateAudit(audit,lock,version),/Unapproved/)
 })
 await test('a production dependency, different advisory/range/severity or critical finding always blocks',()=>{
  for(const change of [x=>{x.lock.packages['node_modules/picomatch'].dev=false},x=>{delete x.lock.packages['node_modules/vite']},x=>{x.audit.vulnerabilities.picomatch.via[0].url='https://github.com/advisories/GHSA-other'},x=>{x.audit.vulnerabilities.picomatch.via[0].range='*'},x=>{x.audit.vulnerabilities.picomatch.via[0].severity='critical'},x=>{x.audit.metadata.vulnerabilities.critical=1}]){const x=fixture();change(x);assert.throws(()=>evaluateAudit(x.audit,x.lock,'0.3.3'))}
 })
 await test('additional high findings on the same node cannot hide behind the approved leaf',()=>{
  const {audit,lock}=fixture();audit.vulnerabilities.picomatch.via.push({...leaf,url:'https://github.com/advisories/GHSA-new'});assert.throws(()=>evaluateAudit(audit,lock,'0.3.3'),/GHSA-new/)
 })
 await test('malformed, unavailable or unresolved audit results fail closed',()=>{
  for(const change of [x=>{x.audit.error={code:'ENETUNREACH'}},x=>{delete x.audit.metadata},x=>{x.audit.auditReportVersion=1},x=>{x.audit.vulnerabilities.vite.via=['missing']},x=>{x.audit.vulnerabilities={}},x=>{x.audit.metadata.vulnerabilities.high=0}]){const x=fixture();change(x);assert.throws(()=>evaluateAudit(x.audit,x.lock,'0.3.3'))}
 })
 await test('clean and moderate-only audits pass without pretending an exception was used',()=>{
  const {audit,lock}=fixture();audit.vulnerabilities={uuid:{severity:'moderate',nodes:[],via:[]}};audit.metadata.vulnerabilities={high:0,critical:0};assert.equal(evaluateAudit(audit,lock,'0.3.4').exceptionUsed,false)
 })
 await test('standalone installer build inputs cannot include build-only matching modules',()=>{
  checkInputs({'packages/pi-spi/lib/installer.cjs':{},'node_modules/tar/index.js':{}})
  for(const file of ['node_modules/picomatch/index.js','node_modules/fdir/index.js','node_modules/node-gyp/bin.js','node_modules/@electron/rebuild/index.js','x/node_modules/tinyglobby/index.js'])assert.throws(()=>checkInputs({[file]:{}}),/Build-only/)
 })
 await test('real ASAR and standalone installer inventory binds version and both content hashes',async()=>{
  const resources=await runtime(),report=scanRuntime(resources,'0.3.3');assert.equal(report.forbiddenModulesAbsent,true);assert.equal(report.scriptsScanned,2);validateInventory(report,'0.3.3',report.installerSha256)
  for(const patch of [{version:'0.3.2'},{policy:'any'},{forbiddenModulesAbsent:false},{scriptsScanned:0},{asarSha256:'invalid'},{installerSha256:'0'.repeat(64)}])assert.throws(()=>validateInventory({...report,...patch},'0.3.3',report.installerSha256))
 })
 await test('0.3.4 runtime inventory uses the same strict policy and rejects cross-version metadata',async()=>{
  const report=scanRuntime(await runtime({},{version:'0.3.4'}),'0.3.4')
  assert.equal(report.policy,ADVISORY);validateInventory(report,'0.3.4',report.installerSha256)
  assert.throws(()=>validateInventory(report,'0.3.3',report.installerSha256));assert.throws(()=>validateInventory(report,'0.3.5',report.installerSha256))
 })
 await test('actual forbidden modules or bundled picomatch code fail the runtime inventory',async()=>{
  for(const files of [{'node_modules/picomatch/index.js':'safe'},{'node_modules/fdir/package.json':'{}'},{'out/index.js':'function analyzeRepeatedExtglob() {}'},{'out/index.js':'require("picomatch")'}]){const resources=await runtime(files);assert.throws(()=>scanRuntime(resources,'0.3.3'),/Build-only|Picomatch/)}
  for(const [file,text]of [['app.asar.unpacked/node_modules/picomatch/index.js','safe'],['app.asar.unpacked/extra.js','analyzeRepeatedExtglob']]){const resources=await runtime(),target=path.join(resources,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);assert.throws(()=>scanRuntime(resources,'0.3.3'),/Build-only|Picomatch/)}
  assert.throws(()=>scanRuntime('missing','0.3.3'))
 })
 await test('version drift, dev declarations and vulnerable code in the helper fail closed',async()=>{
  for(const [pkg,helper]of [[{version:'0.3.2'},'safe'],[{version:'0.3.3',devDependencies:{vite:'*'}},'safe'],[{version:'0.3.3'},'analyzeRepeatedExtglob']]){const resources=await runtime({},pkg,helper);assert.throws(()=>scanRuntime(resources,'0.3.3'))}
 })
 console.log('RESULT PASS',count,'scoped security-policy checks')
}finally{fs.rmSync(tmp,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1})
