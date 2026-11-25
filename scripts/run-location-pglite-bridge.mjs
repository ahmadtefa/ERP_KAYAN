import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
const [id,dirArg]=process.argv.slice(2);
const dir=resolve(dirArg??'build/bridge-evidence');mkdirSync(dir,{recursive:true});
const cases={
 receipt:['KAYAN_LOCATION_UI','src/modules/inventory/batches.operations.integration.spec.ts','real Flutter receipt over HTTP persists location and shows its stock balance'],
 transfer:['KAYAN_TRANSFER_LOCATION_UI','src/modules/inventory/storage-locations.lifecycle.integration.spec.ts','actual Flutter transfer submits physical shelves to production service and SQL'],
 purchase:['KAYAN_PURCHASE_LOCATION_UI','src/modules/purchases/purchase-location-ui.integration.spec.ts','changes persisted receipt destination through the real form, then posts onto it'],
 sales:['KAYAN_SALES_LOCATION_UI','src/modules/sales/sales-locations.integration.spec.ts','real Flutter draft read allocation edit save then SQL post and reverse'],
 stockdoc:['KAYAN_STOCKDOC_LOCATION_UI','src/modules/inventory/stock-documents.locations.integration.spec.ts','actual Flutter old draft read correction save post uses production SQL without duplication'],
 count:['KAYAN_COUNT_LOCATION_UI','src/modules/inventory/stock-takes.locations.integration.spec.ts','actual Flutter count add record finish uses service SQL and preserves frozen physical variance'],
};
assert.ok(cases[id],'Unknown bridge');for(const file of readdirSync(dir))if(file.startsWith(id+'.'))unlinkSync(resolve(dir,file));
const [flag,spec,name]=cases[id];
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const args=['jest',...(process.env.KAYAN_JEST_RUNTIME_CONFIG?['--config',process.env.KAYAN_JEST_RUNTIME_CONFIG]:[]),'--runInBand',spec,'--testNamePattern',escape(name),'--json','--outputFile',dir+'/'+id+'.jest.json'];
const result=spawnSync('npx',args,{cwd:'backend',encoding:'utf8',maxBuffer:12*1024*1024,env:{...process.env,[flag]:'1',KAYAN_BRIDGE_EVIDENCE_DIR:dir,NODE_OPTIONS:[process.env.NODE_OPTIONS,'--experimental-vm-modules'].filter(Boolean).join(' ')}});
writeFileSync(dir+'/'+id+'.parent.stdout',result.stdout??'');writeFileSync(dir+'/'+id+'.parent.stderr',result.stderr??'');
assert.equal(result.status,0,'Selected parent run failed, inspect evidence');
const report=JSON.parse(readFileSync(dir+'/'+id+'.jest.json','utf8'));
assert.equal(report.numFailedTests,0);assert.equal(report.numPassedTests,1);
const all=report.testResults.flatMap(s=>s.assertionResults);const selected=all.filter(t=>t.status==='passed');assert.equal(selected.length,1);assert.ok(selected[0].fullName.endsWith(name));
assert.ok(all.every(t=>['passed','pending'].includes(t.status)));
const sourceCommit=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
const receipt=JSON.parse(readFileSync(dir+'/'+id+'.parent.json','utf8'));
assert.equal(receipt.bridgeId,id);assert.equal(receipt.sourceCommit,sourceCommit);assert.equal(receipt.exitStatus,0);assert.equal(receipt.sqlAssertionsPassed,true);
writeFileSync(dir+'/'+id+'.selection.json',JSON.stringify({parentCase:selected[0].fullName,selectorExcluded:all.filter(t=>t.status==='pending').map(t=>t.fullName),scope:'Only selected parent case ran; pending cases excluded by selector, not accepted'})+'\n');
console.log(id+': exact selected parent and SQL assertions passed; unrelated cases are selector-excluded');
