/* Data-only comparisons for explicit fields and public card-catalog snapshots. */
(function (root) {
  'use strict';
  const record=value=>value!==null&&typeof value==='object'&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
  function canonical(value,ancestors=new Set()) {
    if(value===undefined||value===null)return null;
    if(typeof value==='object') {
      if(!Array.isArray(value)&&!record(value))throw new TypeError('Expected JSON data.');
      if(ancestors.has(value))throw new TypeError('Expected JSON data without circular references.');
      ancestors.add(value);
      try {
        return Array.isArray(value)?value.map(item=>canonical(item,ancestors)):
          Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key],ancestors)]));
      } finally {ancestors.delete(value);}
    }
    if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new TypeError('Expected JSON data.');
    return value;
  }
  const copy=value=>JSON.parse(JSON.stringify(canonical(value)));
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  function compareFields(before,after,keys) {
    if(!record(before)||!record(after)||!Array.isArray(keys)||keys.some(k=>typeof k!=='string'))throw new TypeError('Expected two records and an explicit field list.');
    const own=(object,key)=>Object.hasOwn(object,key)?object[key]:null;
    return [...new Set(keys)].filter(key=>!equal(own(before,key),own(after,key))).map(key=>({key,before:copy(own(before,key)),after:copy(own(after,key))}));
  }
  const cardFields=['rowId','columnId','title','variant','status','descriptions','sourceUrl','images','specifications','displaySpecifications'];
  function cards(catalog) {
    if(!record(catalog)||catalog.format!=='otro-matiz-card-catalog-v1'||!Array.isArray(catalog.cards)||catalog.cards.length>400)throw new TypeError('Expected a public card catalog (version 1, at most 400 cards).');
    const result=new Map();
    for(const card of catalog.cards){
      if(!record(card)||!Object.hasOwn(card,'id')||typeof card.id!=='string'||!card.id||result.has(card.id))throw new TypeError('Catalog cards need unique stable IDs.');
      result.set(card.id,Object.fromEntries(['id',...cardFields].filter(k=>Object.hasOwn(card,k)).map(k=>[k,copy(card[k])])));
    }
    return result;
  }
  function compareCardCatalogs(before,after) {
    const old=cards(before),current=cards(after),added=[],removed=[],updated=[];
    for(const [id,card] of current){
      if(!old.has(id))added.push(card);
      else {const fields=compareFields(old.get(id),card,cardFields);if(fields.length)updated.push({id,fields});}
    }
    for(const [id,card] of old)if(!current.has(id))removed.push(card);
    return {format:'otro-matiz-card-changes-v1',added,removed,updated};
  }
  const api=Object.freeze({compareFields,compareCardCatalogs});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.OtroMatizChanges=api;
})(typeof globalThis==='undefined'?this:globalThis);
