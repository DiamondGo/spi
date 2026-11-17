// Publication/recovery accepts only successful native artifacts from this workflow and tag.
const fs = require('node:fs'), assert = require('node:assert/strict')
const { RELEASE_TARGETS } = require('./distribution.cjs')
function validate(run, workflow, jobs, {repository, sha, sourceRun, currentRun}) {
  assert.equal(run.repository?.full_name, repository, 'Build belongs to another repository')
  assert.equal(run.head_repository?.full_name, repository, 'Build comes from a fork')
  assert.equal(run.workflow_id, workflow.id, 'Build comes from another workflow')
  assert.equal(run.head_sha, sha, 'Build source does not match immutable tag')
  assert.equal(String(run.id), String(sourceRun), 'Unexpected source run')
  if (String(sourceRun) !== String(currentRun)) {
    assert.equal(run.status, 'completed', 'Recovery build is not complete')
    assert.equal(run.conclusion, 'success', 'Recovery build did not succeed')
  }
  for (const target of RELEASE_TARGETS) {
    const matching = jobs.jobs?.filter(job => job.name === 'Native ' + target)
    assert.equal(matching?.length, 1, 'Missing or ambiguous native build: ' + target)
    assert.equal(matching[0].status, 'completed', 'Native build incomplete: ' + target)
    assert.equal(matching[0].conclusion, 'success', 'Native build failed: ' + target)
    assert.equal(String(matching[0].run_id), String(sourceRun), 'Native job belongs to another run')
  }
}
module.exports = {validate}
if (require.main === module) {
  const [run, workflow, jobs, sha] = process.argv.slice(2)
  validate(...[run, workflow, jobs].map(file => JSON.parse(fs.readFileSync(file))), {
    repository:process.env.GITHUB_REPOSITORY, sha, sourceRun:process.env.SOURCE_RUN, currentRun:process.env.GITHUB_RUN_ID
  })
  console.log('Verified exact-tag provenance and all four successful native jobs')
}
