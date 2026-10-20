const fs = require('node:fs');
const path = require('node:path');
const {fixtures} = require('./support.cjs');
const {runBrowser} = require('./browser.cjs');
const {runEvaluation} = require('./evaluate.cjs');

(async () => {
  const context = await fixtures({browserOnly: process.argv.includes('--browser-only')});
  console.log('Fixtures ready: ' + context.runId);
  console.log('Artifacts: ' + context.directory);
  const browser = process.argv.includes('--evaluation-only') ? null : await runBrowser(context);
  const evaluation = process.argv.includes('--browser-only') ? null : await runEvaluation(context);
  const result = {runId: context.runId, browser, metrics: evaluation?.metrics};
  fs.writeFileSync(path.join(context.directory, 'summary.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.resolve(__dirname, '../artifacts/latest-suite.json'), JSON.stringify({runId: context.runId, directory: context.directory}, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (browser?.passed !== browser?.total || evaluation?.results.some(row => !row.passed)) process.exitCode = 1;
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
