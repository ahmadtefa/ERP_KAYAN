import {client,save,load} from './lib.mjs'; import {between,pick,R} from './data.mjs'; import fs from 'node:fs'; import {execSync} from 'node:child_process';
const APW=fs.readFileSync('/tmp/gen/admin.pw','utf8').trim(); const admin=await client('admin',APW); const S=load('S');
const M=n=>Number(n).toFixed(2); let je=0;
const A=c=>S.acc[c], C=c=>S.cc[c];
async function entry(date,desc,lines){const e=await admin('POST','/accounting/journal-entries',{entryDate:date,description:desc,lines:lines.map(l=>({accountId:A(l[0]),debit:l[1]?M(l[1]):undefined,credit:l[2]?M(l[2]):undefined,costCenterId:l[3]?C(l[3]):undefined,description:l[4]}))}); await admin('POST',`/accounting/journal-entries/${e.id}/post`,{}); je++;}
await entry('2026-01-01','زيادة رأس المال المدفوع نقدا وبنكيا لتمويل رأس المال العامل',[['1101',40000000],['1102',20000000],['1107',32000000],['3101',null,92000000]]);
console.log('capital ok');
