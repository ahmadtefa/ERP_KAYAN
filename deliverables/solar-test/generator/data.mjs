import {rng} from './lib.mjs';
export const R=rng(20261124);
export const between=(a,b)=>a+Math.floor(R()*(b-a+1));
export const pick=a=>a[between(0,a.length-1)];
export const pad=(n,w)=>String(n).padStart(w,'0');
const MALE=['أحمد','محمد','محمود','مصطفى','عمرو','خالد','هشام','طارق','حسام','ياسر','كريم','إبراهيم','عبد الله','سامح','وائل','أسامة','شريف','ماجد','رامي','عادل','سعيد','ناصر','فتحي','صلاح','جمال'];
const FEM=['منى','هالة','سلمى','نهى','دعاء','رانيا','أمل','سحر','ريم','هدى','إيمان','شيماء'];
const LAST=['السيد','عبد الرحمن','حسن','علي','إسماعيل','فهمي','منصور','الشريف','عثمان','زكريا','البنا','الجمل','عطية','مرسي','سليمان','الدسوقي','النجار','شحاتة','عبد الحميد','الصاوي','قنديل','رمضان','موسى','الخولي','بكر'];
export const CITIES=['القاهرة','الجيزة','الإسكندرية','المنصورة','طنطا','أسيوط','سوهاج','المنيا','الأقصر','أسوان','الغردقة','الإسماعيلية','بورسعيد','السويس','الفيوم','بني سويف','الزقازيق','دمياط','العين السخنة','مرسى مطروح'];
const CITY_EN={'القاهرة':'Cairo','الجيزة':'Giza','الإسكندرية':'Alexandria','المنصورة':'Mansoura','طنطا':'Tanta','أسيوط':'Assiut','سوهاج':'Sohag','المنيا':'Minya','الأقصر':'Luxor','أسوان':'Aswan','الغردقة':'Hurghada','الإسماعيلية':'Ismailia','بورسعيد':'Port Said','السويس':'Suez','الفيوم':'Faiyum','بني سويف':'Beni Suef','الزقازيق':'Zagazig','دمياط':'Damietta','العين السخنة':'Ain Sokhna','مرسى مطروح':'Marsa Matrouh'};
const EN_FIRST={}; 
const COMP_KIND=['مزرعة','فيلا','مصنع','مدرسة','مستشفى','فندق','شركة','مخبز','مغسلة','مصنع ثلج','ورشة','مول','عمارة','كافيتريا','معهد'];
const COMP_NAME=['الأمل','النور','السلام','الواحة','الفجر','البركة','الريف','الصفوة','الرحمة','الشروق','الهدى','المستقبل','النخيل','الوادي','الزهراء','المدينة','الإيمان','الخير','العروبة','التوحيد'];
export function customers(n=200){
  const out=[];
  for(let i=1;i<=n;i++){
    const city=pick(CITIES); const company=R()<0.4;
    let nameAr; 
    if(company) nameAr=`${pick(COMP_KIND)} ${pick(COMP_NAME)} ${pick(['للتجارة','للصناعات الغذائية','للخدمات','للاستثمار',''])}`.trim()+` - ${city}`;
    else nameAr=`${R()<0.85?pick(MALE):pick(FEM)} ${pick(MALE)} ${pick(LAST)}`;
    out.push({code:'C'+pad(i,4),nameAr,nameEn:`Customer ${pad(i,4)} (${CITY_EN[city]})`,phone:`01${pick([0,1,2,5])}${between(10000000,99999999)}`,email:`customer${pad(i,4)}@kayan-solar-test.example`,taxNumber:company?String(between(100000000,999999999)):undefined,address:`${between(1,150)} شارع ${pick(['النصر','الجمهورية','الثورة','سعد زغلول','الجلاء','مصطفى كامل','فيصل','الهرم','طلعت حرب'])}، ${city}`,creditLimit:String(company?between(5,40)*10000:between(1,10)*10000),paymentTermDays:pick([0,0,15,30,45]),notes:'عميل تجريبي وهمي'});
  }
  return out;
}
const SUP_A=['سولار','نور','شمس','إنرجي','بروتك','ألفا','دلتا','نايل','فيوتشر','جرين','بلس','تكنو'];
const SUP_B=['مصر','الشرق','العرب','النيل','الفا','الصحراء','الأهرام','العاصمة','ماكس','أوريجن'];
export function suppliers(n=50){
  const out=[];
  for(let i=1;i<=n;i++){const city=pick(CITIES.slice(0,12));
    out.push({code:'S'+pad(i,3),nameAr:`${pick(SUP_A)} ${pick(SUP_B)} ${pick(['للمعدات الكهربائية','لاستيراد الطاقة','للتوريدات الصناعية','للأنظمة الشمسية','للتجارة'])}`+` ${i}`,nameEn:`Test Supplier ${pad(i,3)}`,phone:`0${pick([2,3,40,50])}${between(1000000,9999999)}`,email:`supplier${pad(i,3)}@kayan-solar-test.example`,taxNumber:String(between(100000000,999999999)),address:`المنطقة الصناعية، ${city}`,paymentTermDays:pick([15,30,45,60,90]),notes:'مورد تجريبي وهمي'});}
  return out;
}
// ---- items: 300
const BR=['سولاريكس','شمس مصر','نور تك','فولتا','إيكو باور','سن لاين','أمبير','ريان إنرجي'];
export const CATS=[
 ['PNL','ألواح شمسية','Solar panels'],['INV','إنفرترات','Inverters'],['BAT','بطاريات تخزين','Batteries'],['MNT','هياكل تثبيت','Mounting structures'],
 ['CAB','كابلات وموصلات','Cables and connectors'],['PRT','حماية وقواطع','Protection and breakers'],['CTL','شواحن ومراقبة','Controllers and monitoring'],
 ['PMP','مضخات شمسية','Solar pumps'],['HTL','سخانات وإضاءة','Heaters and lighting'],['TLS','أدوات ومستلزمات تركيب','Installation supplies']];
export function items(){
  const out=[]; const add=(cat,seq,nameAr,nameEn,unit,cost,markup,tax=14)=>{const price=Math.round(cost*markup/5)*5||cost; out.push({code:`${cat}-${pad(seq,3)}`,cat,nameAr,nameEn,unit,cost:Number(cost.toFixed(2)),price,tax});};
  let s=0;
  const pw=[330,375,400,450,500,545,550,580,610,650,670,700];const pt=['أحادي البلورة','ثنائي الوجه','متعدد البلورات','Half-Cut'];
  for(let i=0;i<30;i++){const w=pw[i%pw.length];const t=pt[i%pt.length];const b=BR[i%BR.length];add('PNL',++s,`لوح شمسي ${w} واط ${t} - ${b}`,`Solar panel ${w}W ${i%4===1?'bifacial':'mono'} (${b})`,'لوح',w*(10+between(0,30)/10)*1.0,1.2);} s=0;
  const kinds=[['أونجريد',[3,5,8,10,15,20,30,40,50,60,80,100],'kW'],['هايبرد',[3,5,6,8,10,12],'kW'],['أوف جريد',[1,2,3,5],'kVA']];
  for(const [k,sizes,u] of kinds){for(const z of sizes){for(const phase of [1,3]){ if(out.filter(x=>x.cat==='INV').length>=35)break; if(k!=='أونجريد'&&z<5&&phase===3)continue; if(z>10&&phase===1)continue; add('INV',++s,`إنفرتر ${k} ${z} ${u} ${phase===1?'فاز واحد':'3 فاز'} - ${BR[s%BR.length]}`,`${k==='أونجريد'?'On-grid':k==='هايبرد'?'Hybrid':'Off-grid'} inverter ${z}${u} ${phase}ph`,'قطعة',z*(u==='kW'?3200:2500)+between(500,4000),1.18);}}}
  while(out.filter(x=>x.cat==='INV').length<35){add('INV',++s,`إنفرتر مصغر ${s} - ${BR[s%BR.length]}`,`Micro inverter ${s}`,'قطعة',2800+s*70,1.2);}
  s=0;
  const bat=[['ليثيوم LiFePO4','kWh',[2.4,5,5.12,7.2,10,10.24,14.3,15,20,30],'rack',9000],['جل','Ah',[100,150,200,250],'قطعة',4200],['أنبوبية','Ah',[150,200,220,250],'قطعة',6800],['AGM','Ah',[100,120,200],'قطعة',3600]];
  for(const [t,u,vals,unit,per] of bat){for(const v of vals){ if(out.filter(x=>x.cat==='BAT').length>=30)break; add('BAT',++s,`بطارية ${t} ${v} ${u==='kWh'?'كيلوواط ساعة':'أمبير'} - ${BR[s%BR.length]}`,`${t==='جل'?'Gel':t==='أنبوبية'?'Tubular':t==='AGM'?'AGM':'LiFePO4'} battery ${v}${u}`,unit,u==='kWh'?v*per:v*per/100*1.0*1,1.15);}}
  while(out.filter(x=>x.cat==='BAT').length<30){add('BAT',++s,`بطارية احتياطية ${s}`,`Backup battery ${s}`,'قطعة',5000+s*100,1.15);}
  s=0;
  const mnt=['هيكل سطح خرساني','هيكل سطح صاج','هيكل أرضي','هيكل مظلة سيارات','هيكل مزرعة','قاعدة تثبيت قابلة للضبط','قضيب ألومنيوم','مشبك منتصف','مشبك طرفي','قدم تثبيت'];
  for(let i=0;i<30;i++){const m=mnt[i%mnt.length];const n=Math.floor(i/mnt.length)+1;add('MNT',++s,`${m} ${[4,6,10][n-1]||n} ألواح`,`Mounting ${m} for ${[4,6,10][n-1]||n} panels`,i%3===0?'طقم':'قطعة',250+(i%10)*180+n*120,1.3);}
  s=0;
  const cab=[['كابل شمسي','4 مم'],['كابل شمسي','6 مم'],['كابل شمسي','10 مم'],['كابل نحاس','2x6 مم'],['كابل نحاس','4x10 مم'],['كابل نحاس','4x16 مم'],['كابل نحاس','4x25 مم'],['كابل بطارية','25 مم'],['كابل بطارية','35 مم'],['كابل بطارية','50 مم']];
  for(let i=0;i<20;i++){const c=cab[i%cab.length];add('CAB',++s,`${c[0]} ${c[1]} ${i<10?'أحمر':'أسود'} (لفة 100 متر)`,`${c[0]} ${c[1]} ${i<10?'red':'black'} 100m roll`,'لفة',900+(i%10)*650,1.2);}
  for(let i=0;i<20;i++){const c=['موصل MC4 ذكر/أنثى','موصل Y فرعي','مشبك كابل','لقمة نحاس','غلاف حراري','علبة تجميع','قناة كابلات','مسمار تأريض','سلك تأريض','وصلة تمديد'][i%10];add('CAB',++s,`${c} ${i<10?'نوع أ':'نوع ب'}`,`${c} type ${i<10?'A':'B'}`,'قطعة',15+(i%10)*28,1.6);}
  s=0;
  const prt=['قاطع DC','قاطع AC','فيوز DC','حامل فيوز','مانع صواعق','واقي تيار زائد SPD','مفتاح عزل DC','قاطع تفاضلي','صندوق حماية','مأخذ حماية'];
  for(let i=0;i<40;i++){const p=prt[i%prt.length];const a=[16,25,32,40,63,80,100,125][Math.floor(i/10)*2%8]||32;add('PRT',++s,`${p} ${a} أمبير`,`${p} ${a}A`,'قطعة',60+a*4.5+(i%10)*35,1.35);}
  s=0;
  const ctl=['شاحن MPPT','شاحن PWM','عداد ذكي','كارت واي فاي مراقبة','لوحة تحكم','حساس إشعاع','شاشة عرض','ريليه تحكم','مسجل بيانات','محول إشارة'];
  for(let i=0;i<20;i++){const c=ctl[i%10];const a=[30,60,100][Math.floor(i/10)+i%2]||60;add('CTL',++s,`${c} ${a} أمبير ${BR[i%BR.length]}`,`${c} ${a}A`,'قطعة',700+(i%10)*420+a*10,1.3);}
  s=0;
  for(let i=0;i<20;i++){const hp=[0.5,0.75,1,1.5,2,3,4,5.5,7.5,10][i%10];add('PMP',++s,`مضخة شمسية ${hp} حصان ${i<10?'غاطسة':'سطحية'}`,`Solar pump ${hp}HP ${i<10?'submersible':'surface'}`,'قطعة',hp*5200+4500+(i<10?2500:0),1.25);}
  s=0;
  for(let i=0;i<10;i++){const l=[100,150,200,250,300][i%5];add('HTL',++s,`سخان مياه شمسي ${l} لتر ${i<5?'أنابيب مفرغة':'لوح مسطح'}`,`Solar water heater ${l}L`,'قطعة',l*28+3500,1.3);}
  for(let i=0;i<15;i++){const w=[20,40,60,100,150][i%5];add('HTL',++s,`كشاف شمسي ${w} وات ${i<5?'LED مع حساس':i<10?'LED مع ريموت':'شارع متكامل'}`,`Solar floodlight ${w}W`,'قطعة',w*14+250,1.5);}
  s=0;
  const tls=['شريط عازل','أربطة بلاستيك','مسامير استانلس','براغي ربط','مادة عزل مطاطي','مفتاح ربط','كماشة كابلات','جهاز قياس رقمي','خوذة أمان','قفازات عازلة','سلم ألومنيوم','لافتة تحذير','سيليكون مانع تسرب','أنابيب PVC','صندوق أدوات'];
  for(let i=0;i<30;i++){const t=tls[i%15];add('TLS',++s,`${t} ${i<15?'- عبوة صغيرة':'- عبوة كبيرة'}`,`${t} ${i<15?'small pack':'bulk pack'}`,i%2?'عبوة':'قطعة',12+(i%15)*38,1.7,i%5===0?0:14);}
  if(out.length!==300) throw new Error('items='+out.length);
  return out;
}
