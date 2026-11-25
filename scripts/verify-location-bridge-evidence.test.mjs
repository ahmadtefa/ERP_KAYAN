import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bridges,inspectChild,inspectParent} from './verify-location-bridge-evidence.mjs';
const bridge=bridges[0];
function events(){return [
 {type:'suite',suite:{id:1,path:'/repo/test/widget/'+bridge.file}},
 {type:'testStart',test:{id:2,suiteID:1,name:bridge.name}},
 {type:'testDone',testID:2,result:'success',skipped:false,hidden:false},
 {type:'done',success:true},
];}
const log=a=>a.map(e=>JSON.stringify(e)).join('\n');
test('accepts exact single child and scoped successful parent',()=>{
 assert.equal(inspectChild(log(events()),bridge,'0').id,'receipt');
 assert.equal(inspectParent({bridgeId:'receipt',exitStatus:0,sqlAssertionsPassed:true,sourceCommit:'a'.repeat(40)},bridge),'a'.repeat(40));
});
for(const [name,mutate] of [
 ['hidden failure',a=>a.push({type:'testStart',test:{id:9,name:'loading'}},{type:'testDone',testID:9,result:'failure',hidden:true,skipped:false})],
 ['hidden skip',a=>a.push({type:'testStart',test:{id:9,name:'loading'}},{type:'testDone',testID:9,result:'success',hidden:true,skipped:true})],
 ['unfinished child',a=>a.push({type:'testStart',test:{id:9,name:'unfinished'}})],
 ['skipped metadata',a=>a[1].test.metadata={skip:true}],
 ['wrong name',a=>a[1].test.name='different'],
 ['wrong fixture',a=>a[0].suite.path='/repo/test/widget/other_test.dart'],
 ['skipped',a=>a[2].skipped=true],
 ['failed',a=>a[2].result='failure'],
 ['no done',a=>a.pop()],
 ['false done',a=>a[3].success=false],
 ['duplicate done',a=>a.push(a[3])],
 ['error event',a=>a.push({type:'error',testID:2,error:'failure'})],
 ['no selected test',a=>a.splice(1,2)],
 ['duplicate visible completion',a=>a.push(a[2])],
])test('refuses '+name,()=>{const a=events();mutate(a);assert.throws(()=>inspectChild(log(a),bridge,'0'));});
test('refuses invalid json and nonzero child even with a passing event',()=>{
 assert.throws(()=>inspectChild('not JSON\n'+log(events()),bridge,0));
 assert.throws(()=>inspectChild(log(events()),bridge,1));
});
for(const patch of [{bridgeId:'other'},{exitStatus:1},{sqlAssertionsPassed:false},{sourceCommit:'bad'}])test('refuses unproven parent '+Object.keys(patch)[0],()=>{
 assert.throws(()=>inspectParent({bridgeId:'receipt',exitStatus:0,sqlAssertionsPassed:true,sourceCommit:'a'.repeat(40),...patch},bridge));
});
