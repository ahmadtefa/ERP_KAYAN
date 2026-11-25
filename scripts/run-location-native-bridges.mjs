import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
const dir=resolve(process.argv[2]??'build/bridge-evidence');mkdirSync(dir,{recursive:true});
for(const [id,flag] of [['opening','KAYAN_OB_LOCATION_UI'],['stockdoc-lot','KAYAN_STOCKDOC_LOT_UI'],['stockdoc-split','KAYAN_STOCKDOC_SPLIT_UI']]){
 for(const file of readdirSync(dir))if(file.startsWith(id+'.'))unlinkSync(resolve(dir,file));
 const result=spawnSync(process.execPath,['backend/scripts/isolated-pg-cluster.cjs','run','--',process.execPath,'backend/scripts/isolated-pg-purchase-concurrency.cjs'],{encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024,env:{...process.env,[flag]:'1',KAYAN_BRIDGE_EVIDENCE_DIR:dir}});
 writeFileSync(dir+'/'+id+'.native.stdout',result.stdout??'');writeFileSync(dir+'/'+id+'.native.stderr',result.stderr??'');
 assert.equal(result.status,0,id+' native bridge failed, inspect evidence');
 const receipt=JSON.parse(readFileSync(dir+'/'+id+'.parent.json','utf8'));
 assert.equal(receipt.bridgeId,id);assert.equal(receipt.sqlAssertionsPassed,true);assert.equal(receipt.exitStatus,0);
 console.log(id+': isolated native parent completed, final nine-bridge checker still required');
}
