const {transform}=require('next/dist/build/swc/index.js');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};
const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const ln=e.message.match(/(\d+:\d+)/g);console.log(name+': FAIL @'+(ln?ln[0]:'?')+' - '+e.message.split('\n').filter(l=>l.includes('Unexpected')||l.includes('Expected')).join(' | '));}};

// Minimal: template literal with replace(/"/g, '""') inside ${}
test('regex-in-template',`
import React from 'react';
export function T({x}:{x:string}){
  const v = \`"\${x.replace(/"/g, '""')}"\`;
  return <div>{v}</div>;
}`);

// With displayRows forEach
test('foreach-with-template-regex',`
import React,{useState}from 'react';
export function T({rows}:{rows:any[]}){
  const lines:string[]=[];
  rows.forEach((row)=>{
    lines.push([
      \`"\${(row.product_name||'').replace(/"/g,'""')}"\`,
      \`"\${(row.sku||'').replace(/"/g,'""')}"\`,
    ].join(','));
  });
  return <div>{lines.join('\\n')}</div>;
}`);

// With useState + the forEach 
test('usestate+foreach-template-regex',`
import React,{useState}from 'react';
export function T({rows}:{rows:any[]}){
  const[a,setA]=useState<any[]>([]);
  const[b,setB]=useState(0);
  const[c,setC]=useState('');
  const[d,setD]=useState('');
  const[e,setE]=useState('');
  const[f,setF]=useState('');
  const[g,setG]=useState('');
  const download=()=>{
    const lines:string[]=[];
    rows.forEach((row)=>{
      lines.push([
        \`"\${(row.product_name||'').replace(/"/g,'""')}"\`,
        \`"\${(row.sku||'').replace(/"/g,'""')}"\`,
      ].join(','));
    });
  };
  return <div/>;
}`);

// The specific line that might cause issues - template literal containing regex with /"/g
test('template-with-double-quote-regex',`
import React from 'react';
export function T(){
  const fn=()=>{
    const lines:string[]=[];
    const headers=['#','Product'];
    const row={product_name:'x',option_label:'y',sku:'z',brand:'b',supplier_name:'s'};
    lines.push([
      String(1),
      \`"\${(row.product_name||'').replace(/"/g,'""')}"\`,
      \`"\${(row.option_label||'').replace(/"/g,'""')}"\`,
      \`"\${(row.sku||'').replace(/"/g,'""')}"\`,
      \`"\${(row.brand||'').replace(/"/g,'""')}"\`,
      \`"\${(row.supplier_name||'').replace(/"/g,'""')}"\`,
    ].join(','));
  };
  return <div/>;
}`);
