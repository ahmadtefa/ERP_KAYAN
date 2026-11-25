import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const bridges = [
 ['receipt','location_http_receipt_test.dart','isolated receipt HTTP to actual service and location balance','pglite'],
 ['transfer','batch_transfer_http_test.dart','actual transfer dialog sends named source and target into migrated SQL','pglite'],
 ['purchase','purchase_location_http_test.dart','real purchase destination edit uses actual API read and draft save','pglite'],
 ['sales','sales_location_http_test.dart','real sales source edit retains typed carton units on actual API read and save','pglite'],
 ['stockdoc','stock_document_locations_http_test.dart','old stock transfer draft actual read correct save then post','pglite'],
 ['count','stock_take_locations_http_test.dart','actual count add record finish','pglite'],
 ['opening','opening_locations_http_test.dart','actual opening draft read post','native'],
 ['stockdoc-lot','stock_document_lot_create_http_test.dart','generic barcode transfer explicit lot create post reverse','native'],
 ['stockdoc-split','stock_document_lot_split_http_test.dart','existing transfer draft explicit lot split save post reverse','native'],
].map(([id,file,name,sql])=>({id,file,name,sql}));

export function inspectChild(text,bridge,exitStatus){
 assert.equal(String(exitStatus).trim(),'0','Child exit must be zero');
 const suites=new Map(),tests=new Map(),finished=[],completed=new Set();let done=0;
 for(const line of text.split(/\r?\n/)){
  if(!line.trim())continue;
  const e=JSON.parse(line);
  if(e.type==='suite')suites.set(e.suite.id,e.suite.path.replaceAll('\\','/'));
  if(e.type==='testStart'){assert.ok(!tests.has(e.test.id),'Duplicate test identity');assert.notEqual(e.test.metadata?.skip,true,'Skip metadata forbids acceptance');tests.set(e.test.id,e.test);}
  assert.notEqual(e.type,'error','Child error events forbid acceptance');
  if(e.type==='testDone'){const t=tests.get(e.testID);assert.ok(t,'Unknown completed child');assert.ok(!completed.has(e.testID),'Duplicate completion');completed.add(e.testID);assert.equal(e.skipped,false,'Skipped bridge');assert.equal(e.result,'success','Failed bridge');if(!e.hidden)finished.push(t);}
  if(e.type==='done'){done++;assert.equal(e.success,true,'Flutter done must succeed');}
 }
 assert.equal(completed.size,tests.size,'Unfinished child test');
 assert.equal(done,1,'Exactly one complete Flutter run required');
 assert.equal(finished.length,1,'Exactly one visible bridge test required');
 const t=finished[0];assert.equal(t.name,bridge.name,'Wrong bridge test');
 assert.ok(suites.get(t.suiteID)?.endsWith('/test/widget/'+bridge.file),'Wrong fixture path');
 return {id:bridge.id,status:'PASS',fixture:bridge.file,test:t.name,sql:bridge.sql,scope:'Flutter HTTP to production service and migrated synthetic SQL; not installed JWT/licence proof'};
}

export function inspectParent(parent,bridge){
 assert.equal(parent.bridgeId,bridge.id,'Wrong parent bridge');
 assert.equal(parent.exitStatus,0,'Parent failed');
 assert.equal(parent.sqlAssertionsPassed,true,'Missing parent SQL assertions');
 assert.equal(typeof parent.sourceCommit,'string');assert.match(parent.sourceCommit,/^[a-f0-9]{40}$/);
 return parent.sourceCommit;
}

function main(dir,output){
 const results=[];let commit;
 const expected=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 for(const b of bridges){
  const parent=JSON.parse(readFileSync(join(dir,b.id+'.parent.json'),'utf8'));
  const c=inspectParent(parent,b);assert.equal(c,expected,'Evidence is not current source');if(commit)assert.equal(c,commit,'Mixed source evidence');commit=c;
  results.push(inspectChild(readFileSync(join(dir,b.id+'.flutter.jsonl'),'utf8'),b,readFileSync(join(dir,b.id+'.flutter.status'),'utf8')));
 }
 const report={sourceCommit:commit,scope:'Standalone nine bridge qualification only. Does not change comprehensive acceptance or classify other skipped tests.',results};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('Nine bridge child runs and parent SQL assertions verified');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{assert.equal(process.argv.length,4);main(process.argv[2],process.argv[3]);}catch(e){console.error('Bridge evidence refused: '+e.message);process.exitCode=1;}
}
