const test=require('node:test');
const assert=require('node:assert/strict');
const {compareFields,compareCardCatalogs}=require('../catalog-changes.js');
const card=(id,extra={})=>({id,title:'Desk lamp',status:'ready',specifications:[{key:'price',label:'Price',value:'25 EUR',scope:'cell'}],...extra});
const catalog=cards=>({format:'otro-matiz-card-catalog-v1',cards});
test('compares explicit fields with copied old/new values',()=>{
  assert.deepEqual(compareFields({price:25,privateNote:'old'},{price:29,privateNote:'new'},['price']),[{key:'price',before:25,after:29}]);
});
test('object key order does not create a change; list order does',()=>{
  assert.deepEqual(compareFields({x:{b:2,a:1}},{x:{a:1,b:2}},['x']),[]);
  assert.equal(compareFields({x:['a','b']},{x:['b','a']},['x']).length,1);
});
test('missing and null values compare consistently',()=>{
  assert.deepEqual(compareFields({},{x:null},['x']),[]);
  assert.deepEqual(compareFields({x:'old'},{},['x']),[{key:'x',before:'old',after:null}]);
});
test('detects additions, removals and updated cards by stable ID',()=>{
  const d=compareCardCatalogs(catalog([card('lamp'),card('old')]),catalog([card('lamp',{title:'Reading lamp'}),card('new')]));
  assert.equal(d.added[0].id,'new');assert.equal(d.removed[0].id,'old');assert.deepEqual(d.updated[0],{id:'lamp',fields:[{key:'title',before:'Desk lamp',after:'Reading lamp'}]});
});
test('reordering cards creates no content changes',()=>{
  assert.deepEqual(compareCardCatalogs(catalog([card('a'),card('b')]),catalog([card('b'),card('a')])),{format:'otro-matiz-card-changes-v1',added:[],removed:[],updated:[]});
});
test('preserves pending cards and does not fetch images or links',()=>{
  const d=compareCardCatalogs(catalog([]),catalog([card('pending',{status:'pending',sourceUrl:'https://example.invalid/item',images:{primary:null}})]));
  assert.equal(d.added[0].status,'pending');assert.equal(d.added[0].sourceUrl,'https://example.invalid/item');
});
test('extra workspace fields are excluded from comparisons and added cards',()=>{
  const a=card('a',{favorite:true,privateNote:'private example',decision:{status:'selected'}});
  const d=compareCardCatalogs(catalog([]),catalog([a]));assert(!JSON.stringify(d).includes('private example'));assert(!Object.hasOwn(d.added[0],'decision'));
  assert.deepEqual(compareCardCatalogs(catalog([a]),catalog([{...a,privateNote:'different'}])).updated,[]);
});
test('requires a catalog rather than an editable project or unknown version',()=>{
  for(const c of [{schemaVersion:1,data:{}},{format:'otro-matiz-card-catalog-v2',cards:[]},null])assert.throws(()=>compareCardCatalogs(c,c));
});
test('refuses duplicate IDs and oversized catalogs',()=>{
  assert.throws(()=>compareCardCatalogs(catalog([]),catalog([card('same'),card('same')])));
  assert.throws(()=>compareCardCatalogs(catalog([]),catalog(Array.from({length:401},(_,i)=>card(String(i))))));
});
test('does not mutate either input and returned values share no references',()=>{
  const before=catalog([card('lamp')]),after=catalog([card('lamp',{descriptions:['New finish']})]),saved=JSON.stringify([before,after]);
  const d=compareCardCatalogs(before,after);d.updated[0].fields[0].after.push('Later edit');assert.equal(JSON.stringify([before,after]),saved);
});
test('invalid field selection and non-JSON values are refused',()=>{
  assert.throws(()=>compareFields({},null,[]));assert.throws(()=>compareFields({},{},'price'));assert.throws(()=>compareFields({x:Infinity},{x:1},['x']));
});


test('headless comparison API can be imported from standard input',()=>{
  const {spawnSync}=require('node:child_process');
  const url=require('node:url').pathToFileURL(require('node:path').join(__dirname,'../scripts/render-gallery.mjs')).href;
  const code=`import {compareCardCatalogs} from ${JSON.stringify(url)}; const c={format:'otro-matiz-card-catalog-v1',cards:[]}; console.log(JSON.stringify(compareCardCatalogs(c,c)));`;
  const result=spawnSync(process.execPath,['--input-type=module','-'],{input:code,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).format,'otro-matiz-card-changes-v1');
});


test('rejects non-JSON objects and cycles but accepts shared JSON values',()=>{
  const cycle={};cycle.self=cycle;
  for(const x of [new Date(0),new Map(),new Set(),1n,()=>1,cycle])
    assert.throws(()=>compareFields({x},{x},['x']),TypeError);
  const shared={finish:'matte'};
  assert.deepEqual(compareFields({x:[shared,shared]},{x:[{finish:'matte'},{finish:'matte'}]},['x']),[]);
});
test('only own record fields count, and prototype-bearing inputs are rejected',()=>{
  assert.deepEqual(compareFields({},Object.create(null),['constructor','toString','__proto__']),[]);
  assert.deepEqual(compareFields({},JSON.parse('{"__proto__":"explicit value"}'),['__proto__']),[{key:'__proto__',before:null,after:'explicit value'}]);
  for(const value of [[],new Date(),Object.create({price:25})])assert.throws(()=>compareFields(value,{},['price']),TypeError);
  assert.throws(()=>compareCardCatalogs(catalog([]),catalog([Object.create(card('inherited'))])),TypeError);
});
test('browser entry point exposes the same data-only comparison API',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../catalog-changes.js'),'utf8'),context);
  const result=vm.runInContext(`JSON.stringify(OtroMatizChanges.compareFields({price:25},{price:29},['price']))`,context);
  assert.deepEqual(JSON.parse(result),[{key:'price',before:25,after:29}]);
});
test('compares actual adapter outputs without exporting editable workspace notes',async()=>{
  const {pathToFileURL}=require('node:url'),path=require('node:path');
  const api=await import(pathToFileURL(path.join(__dirname,'../scripts/render-gallery.mjs')).href);
  const make=name=>api.prepareProject({text:JSON.stringify([{sku:'lamp',name,price:'25 EUR',product_url:'https://example.invalid/lamp'}]),filename:'lamps.json'});
  const before=make('Desk lamp'),after=make('Reading lamp');
  after.decisions={lamp:{privateNote:'workspace-only-marker'}};
  const changes=api.compareCardCatalogs(api.createCardCatalog(before),api.createCardCatalog(after));
  const fields=changes.updated.find(item=>item.id==='lamp').fields;
  assert.deepEqual(fields.find(field=>field.key==='title'),{key:'title',before:'Desk lamp',after:'Reading lamp'});
  assert.doesNotMatch(JSON.stringify(changes),/workspace-only-marker/);
});
