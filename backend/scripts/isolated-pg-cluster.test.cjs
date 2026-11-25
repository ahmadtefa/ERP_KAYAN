'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {stopCluster,SENTINEL_NAME,SENTINEL_TEXT}=require('./isolated-pg-cluster.cjs');
test('failed shutdown preserves owned data instead of deleting possibly live cluster',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kayan-pg-')),data=path.join(root,'data'),bin=path.join(root,'bin');
 fs.mkdirSync(data);fs.mkdirSync(bin);fs.writeFileSync(path.join(data,SENTINEL_NAME),SENTINEL_TEXT);
 const ctl=path.join(bin,'pg_ctl');fs.writeFileSync(ctl,'#!/bin/sh\nexit 1\n',{mode:0o700});
 try {await assert.rejects(stopCluster({root,data,bin,started:true,created:true}),/shutdown unverified/);assert.equal(fs.existsSync(data),true);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('proven already stopped cluster can be removed after redundant stop fails',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kayan-pg-')),data=path.join(root,'data'),bin=path.join(root,'bin');
 fs.mkdirSync(data);fs.mkdirSync(bin);fs.writeFileSync(path.join(data,SENTINEL_NAME),SENTINEL_TEXT);
 fs.writeFileSync(path.join(bin,'pg_ctl'),'#!/bin/sh\nfor a in "$@"; do if [ "$a" = status ]; then exit 3; fi; done\nexit 1\n',{mode:0o700});
 await stopCluster({root,data,bin,started:true,created:true});assert.equal(fs.existsSync(root),false);
});
