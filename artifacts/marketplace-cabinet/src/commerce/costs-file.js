// Preserved from the approved Dashboard-node-v1 prototype.
import {parseCsv,validateImport} from './costs-model.js';
const decoder=new TextDecoder('utf-8');
function xml(text){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Повреждён XML внутри Excel-файла.');return doc;}
function nodes(root,name){return [...root.getElementsByTagNameNS('*',name)];}
async function zipEntries(buffer){
 const view=new DataView(buffer),bytes=new Uint8Array(buffer),map=new Map();let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Не удалось прочитать XLSX. Используйте образец или CSV.');
 const count=view.getUint16(end+10,true);let pos=view.getUint32(end+16,true),total=0;
 if(count>2000)throw Error('Слишком сложный Excel-файл. Используйте образец.');
 for(let i=0;i<count;i++){
  if(view.getUint32(pos,true)!==0x02014b50)throw Error('Повреждён Excel-файл.');
  const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),size=view.getUint32(pos+20,true),rawSize=view.getUint32(pos+24,true),nameLen=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),offset=view.getUint32(pos+42,true),name=decoder.decode(bytes.subarray(pos+46,pos+46+nameLen));
  total+=rawSize;if(rawSize>8e6||total>24e6||flags&1)throw Error('Файл слишком большой или защищён паролем.');
  map.set(name,{method,size,rawSize,offset});pos+=46+nameLen+extra+comment;
 }
 return async name=>{
  const e=map.get(name);if(!e)return null;
  if(view.getUint32(e.offset,true)!==0x04034b50)throw Error('Повреждён Excel-файл.');
  const start=e.offset+30+view.getUint16(e.offset+26,true)+view.getUint16(e.offset+28,true),packed=bytes.subarray(start,start+e.size);let raw;
  if(e.method===0)raw=packed;else if(e.method===8){const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8e6){await reader.cancel();throw Error('Слишком большой лист Excel.');}chunks.push(value);}raw=new Uint8Array(length);let i=0;for(const chunk of chunks){raw.set(chunk,i);i+=chunk.length;}}else throw Error('Неподдерживаемое сжатие Excel-файла.');
  if(raw.length!==e.rawSize)throw Error('Excel-файл повреждён.');return decoder.decode(raw);
 };
}
export async function readTabularFile(file){
 if(file.size>5e6)throw Error('Размер файла — до 5 МБ.');
 if(/\.csv$/i.test(file.name))return parseCsv(await file.text());
 if(!/\.xlsx$/i.test(file.name))throw Error('Выберите XLSX или CSV. Старый формат XLS сохраните в XLSX.');
 const read=await zipEntries(await file.arrayBuffer()),bookText=await read('xl/workbook.xml'),relText=await read('xl/_rels/workbook.xml.rels');
 if(!bookText||!relText)throw Error('В файле нет книги Excel.');
 const book=xml(bookText),first=nodes(book,'sheet')[0],rid=first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),rel=nodes(xml(relText),'Relationship').find(r=>r.getAttribute('Id')===rid);
 const target=rel?.getAttribute('Target');if(!target||target.includes('..')||/^[a-z]+:/i.test(target))throw Error('Не удалось прочитать первый лист Excel.');
 const sheetText=await read(target.startsWith('/')?target.slice(1):'xl/'+target);if(!sheetText)throw Error('Первый лист Excel отсутствует.');
 const sharedText=await read('xl/sharedStrings.xml'),shared=sharedText?nodes(xml(sharedText),'si').map(s=>nodes(s,'t').map(n=>n.textContent).join('')):[];
 const rows=nodes(xml(sheetText),'row').map(row=>{
  const cells=[];for(const cell of nodes(row,'c')){
   const ref=cell.getAttribute('r')||'',column=ref.match(/^[A-Z]+/)?.[0];if(!column)continue;
   const index=[...column].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
   let value=cell.getAttribute('t')==='s'?shared[Number(nodes(cell,'v')[0]?.textContent)]:cell.getAttribute('t')==='inlineStr'?nodes(cell,'t').map(t=>t.textContent).join(''):nodes(cell,'v')[0]?.textContent||'';
   if(nodes(cell,'f').length)throw Error('В загружаемом файле должны быть готовые значения, а не формулы. Вставьте их как значения.');
   if(index>20&&value)throw Error('Используйте файл с двумя столбцами по образцу.');if(index<=20)cells[index]=value;
  }return Array.from(cells,v=>v??'');
 }).filter(row=>row.some(v=>String(v).trim()));
 return rows;
}
export async function readCostFile(file){return validateImport(await readTabularFile(file));}
