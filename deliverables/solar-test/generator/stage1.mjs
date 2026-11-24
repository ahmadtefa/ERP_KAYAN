import {login,api,save,load} from './lib.mjs'; import {customers,suppliers,items,CATS,pad,between,pick,R} from './data.mjs'; import fs from 'node:fs'; import crypto from 'node:crypto';
await login('admin',fs.readFileSync('/tmp/gen/admin.pw','utf8').trim());
const S={};
// company
await api('PATCH','/company/profile',{nameAr:'كيان للطاقة الشمسية',nameEn:'Kayan Solar Energy',phone:'+20 2 2555 0100',email:'info@kayan-solar-test.example',address:'القاهرة، مصر (بيانات تجريبية)'}).catch(e=>console.log('profile',e.message.slice(0,200)));
// branches
const hq=(await api('GET','/company/branches'))[0]; S.branches={HQ:hq.id};
for(const [c,ar,en] of [['ALX','فرع الإسكندرية','Alexandria Branch'],['MNS','فرع المنصورة','Mansoura Branch'],['AST','فرع أسيوط','Assiut Branch'],['HRG','فرع الغردقة','Hurghada Branch']]){
  const b=await api('POST','/company/branches',{code:c,nameAr:ar,nameEn:en,kind:'BRANCH',parentBranchId:hq.id}); S.branches[c]=b.id||b.branch?.id;}
// admin gets every branch
{const me=await api('GET','/auth/me').catch(()=>null); const us=await api('GET','/admin/users'); const list=us.items||us; const ad=list.find(u=>u.username==='admin');
 await api('PATCH','/admin/users/'+ad.id,{branchIds:Object.values(S.branches)}); await login('admin',fs.readFileSync('/tmp/gen/admin.pw','utf8').trim());}
// warehouses
let whs=await api('GET','/inventory/warehouses'); S.wh=Object.fromEntries(whs.items.map(w=>[w.code,w.id]));
const W=[['HQ-INV','HQ','مخزن الإنفرترات والبطاريات - القاهرة','Cairo inverters and batteries store'],['HQ-ACC','HQ','مخزن الملحقات - القاهرة','Cairo accessories store'],
['ALX-MAIN','ALX','المخزن الرئيسي - الإسكندرية','Alexandria main store'],['ALX-BAT','ALX','مخزن البطاريات - الإسكندرية','Alexandria battery store'],['ALX-ACC','ALX','مخزن الملحقات - الإسكندرية','Alexandria accessories store'],
['MNS-MAIN','MNS','المخزن الرئيسي - المنصورة','Mansoura main store'],['MNS-ACC','MNS','مخزن الملحقات - المنصورة','Mansoura accessories store'],
['AST-MAIN','AST','المخزن الرئيسي - أسيوط','Assiut main store'],['AST-ACC','AST','مخزن الملحقات - أسيوط','Assiut accessories store'],
['HRG-MAIN','HRG','المخزن الرئيسي - الغردقة','Hurghada main store']];
for(const [c,b,ar,en] of W){ if(S.wh[c])continue; const w=await api('POST','/inventory/warehouses',{code:c,branchId:S.branches[b],nameAr:ar,nameEn:en}); S.wh[c]=w.id;}
// 12th warehouse
if(!S.wh['HRG-ACC']){const w=await api('POST','/inventory/warehouses',{code:'HRG-ACC',branchId:S.branches.HRG,nameAr:'مخزن الملحقات - الغردقة',nameEn:'Hurghada accessories store'});S.wh['HRG-ACC']=w.id;}
console.log('warehouses',JSON.stringify(Object.keys(S.wh)));
// accounts
const accs=(await api('GET','/accounting/chart-of-accounts')).items; S.acc=Object.fromEntries(accs.map(a=>[a.code,a.id]));
const EXTRA=[['1106','Advances to suppliers','دفعات مقدمة للموردين','ASSET','11'],['1107','Bank - NBE account','البنك الأهلي - حساب جاري','ASSET','11'],['1108','Customer cheques under collection','شيكات تحت التحصيل','ASSET','11'],['1204','Tools and equipment','عدد وأدوات','ASSET','12'],['1205','Delivery vans','سيارات خدمة','ASSET','12'],
['2105','Customer deposits','دفعات مقدمة من العملاء','LIABILITY','2'],['2106','Accrued tax','ضرائب مستحقة','LIABILITY','2'],['4104','Installation revenue','إيرادات التركيب','REVENUE','4'],['4105','Maintenance contract revenue','إيرادات عقود الصيانة','REVENUE','4'],
['5108','Marketing and advertising','التسويق والإعلان','EXPENSE','5'],['5109','Transport and fuel','النقل والوقود','EXPENSE','5'],['5110','Installation labor','أجور فرق التركيب','EXPENSE','5'],['5111','Warranty and maintenance expense','مصروفات الضمان والصيانة','EXPENSE','5'],['5112','Bank charges','مصروفات بنكية','EXPENSE','5']];
for(const [code,en,ar,type,parent] of EXTRA){const a=await api('POST','/accounting/chart-of-accounts',{code,nameEn:en,nameAr:ar,type,parentId:S.acc[parent],isPostable:true,currency:'EGP'});S.acc[code]=a.id;}
// cost centers
S.cc={};
for(const [c,ar,en,t] of [['CC01','المبيعات','Sales','DEPARTMENT'],['CC02','التركيب','Installation','DEPARTMENT'],['CC03','الصيانة وخدمة ما بعد البيع','Maintenance','DEPARTMENT'],['CC04','المشتريات','Procurement','DEPARTMENT'],['CC05','المخازن والخدمات اللوجستية','Warehousing','DEPARTMENT'],['CC06','الإدارة العامة','General administration','ADMINISTRATIVE_UNIT'],['CC07','الحسابات والمالية','Finance','ADMINISTRATIVE_UNIT'],['CC08','التسويق','Marketing','DEPARTMENT'],['CC09','مشروعات المزارع والطلمبات','Farms and pumping projects','PROJECT'],['CC10','مشروعات المصانع والمباني التجارية','Industrial and commercial projects','PROJECT']]){
  const r=await api('POST','/accounting/cost-centers',{code:c,nameAr:ar,nameEn:en,type:t}); S.cc[c]=r.id;}
// categories
S.cat={}; for(const [c,ar,en] of CATS){const r=await api('POST','/inventory/categories',{code:c,nameAr:ar,nameEn:en}); S.cat[c]=r.id;}
// items
const IT=items(); S.items=[];
for(const it of IT){const r=await api('POST','/inventory/items',{code:it.code,nameAr:it.nameAr,nameEn:it.nameEn,unit:it.unit,categoryId:S.cat[it.cat],salePrice:String(it.price),purchasePrice:String(it.cost),taxRate:String(it.tax),isStockTracked:true,reorderLevel:String(between(3,10)),barcode:'622'+pad(S.items.length+1,9)+String(between(0,9)),notes:'صنف تجريبي'});
  S.items.push({id:r.id,...it});}
console.log('items',S.items.length);
S.customers=[]; for(const c of customers()){const r=await api('POST','/parties/customers',c); S.customers.push({id:r.id,code:c.code,limit:Number(c.creditLimit)});}
S.suppliers=[]; for(const c of suppliers()){const r=await api('POST','/parties/suppliers',c); S.suppliers.push({id:r.id,code:c.code});}
console.log('parties',S.customers.length,S.suppliers.length);
// users
const roles=Object.fromEntries((await api('GET','/admin/roles')).map?.(r=>[r.code,r.id])||(await api('GET','/admin/roles')).items.map(r=>[r.code,r.id]));
const U=[['gm.kayan','أحمد صلاح الدين','Ahmed Salah El-Din','GENERAL_MANAGER',['HQ','ALX','MNS','AST','HRG']],['fin.mgr','هالة محمود','Hala Mahmoud','FINANCE_MANAGER',['HQ']],['acc.cairo','نهى عبد الله','Noha Abdallah','ACCOUNTANT',['HQ']],['sales.mgr','طارق فؤاد','Tarek Fouad','SALES_MANAGER',['HQ','ALX','MNS','AST','HRG']],
['sales.cai','كريم سمير','Karim Samir','SALES_CLERK',['HQ']],['sales.alx','مصطفى حسين','Mostafa Hussein','SALES_CLERK',['ALX']],['sales.mns','ياسر عادل','Yasser Adel','SALES_CLERK',['MNS']],['pur.mgr','وائل رمضان','Wael Ramadan','PURCHASING_MANAGER',['HQ']],['pur.clerk','دعاء إبراهيم','Doaa Ibrahim','PURCHASING_CLERK',['HQ']],
['wh.mgr','عمرو الشريف','Amr El-Sherif','WAREHOUSE_MANAGER',['HQ','ALX','MNS','AST','HRG']],['store.cai','سامح منصور','Sameh Mansour','STOREKEEPER',['HQ','ALX','MNS','AST','HRG']],['store.alx','حسام عثمان','Hossam Osman','STOREKEEPER',['ALX']],['treasurer','منى زكريا','Mona Zakaria','TREASURER',['HQ']],['auditor','خالد البنا','Khaled El-Banna','INTERNAL_AUDITOR',['HQ']],['reports','سلمى الدسوقي','Salma El-Desouky','READ_ONLY',['HQ','ALX']]];
const creds=[{username:'admin',role:'ADMIN (system admin, super admin)',password:fs.readFileSync('/tmp/gen/admin.pw','utf8').trim()}]; S.users={};
for(const [u,ar,en,role,brs] of U){const pw=crypto.randomBytes(12).toString('base64').replace(/[+/=]/g,'x')+'Aa1!';
  const r=await api('POST','/admin/users',{username:u,fullNameAr:ar,fullNameEn:en,password:pw,email:u.replace('.','')+'@kayan-solar-test.example',roleIds:[roles[role]],branchIds:brs.map(b=>S.branches[b])}); S.users[u]=r.id; creds.push({username:u,role,branches:brs,password:pw});}
fs.writeFileSync('/tmp/gen/credentials.json',JSON.stringify(creds,null,1)); fs.chmodSync('/tmp/gen/credentials.json',0o600);
console.log('users',creds.length);
S.roles=roles; save('S',S);
