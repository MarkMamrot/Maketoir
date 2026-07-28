const {transform}=require('next/dist/build/swc/index.js');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};
const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const m=e.message.match(/\d+:\d+/);console.log(name+': FAIL @'+(m?m[0]:'?')+' ->',e.message.split('\n').find(l=>l.includes('nexpected')||l.includes('Expected')));}};

(async()=>{
// Test new Map<number, any> inside JSX expression
await test('new-Map-generic-in-jsx',`
import React,{useState}from 'react';
export function T(){
  const rows=[{stock:[],variant_id:1}];
  return (
    <div>
      {rows.map((row,i)=>{
        const m=new Map<number,any>(row.stock.map((s:any)=>[s.id,s]));
        return <tr key={i}><td>{m.size}</td></tr>;
      })}
    </div>
  );
}`);

// Without generic - should work
await test('new-Map-no-generic-in-jsx',`
import React,{useState}from 'react';
export function T(){
  const rows=[{stock:[],variant_id:1}];
  return (
    <div>
      {rows.map((row,i)=>{
        const m=new Map(row.stock.map((s:any)=>[s.id,s]));
        return <tr key={i}><td>{m.size}</td></tr>;
      })}
    </div>
  );
}`);

// Test ternary with >0 inside JSX
await test('ternary->0-in-jsx',`
import React from 'react';
export function T({x}:{x:number}){
  return <div style={{color: x>0 ? 'green' : 'red'}}>{x}</div>;
}`);

// Test displayRows.map with the locStockMap pattern  
await test('locStockMap-full-pattern',`
import React from 'react';
export function T(){
  const displayRows:any[]=[];
  const locations:any[]=[];
  const numCell:React.CSSProperties={};
  return (
    <table>
      <tbody>
        {displayRows.map((row,i)=>{
          const locStockMap=new Map<number,any>(row.stock.map((s:any)=>[s.location_id,s]));
          const soh=locStockMap.get(1)?.soh??0;
          return <tr key={row.variant_id}><td style={{...numCell,color:soh>0?'green':'red'}}>{soh}</td></tr>;
        })}
      </tbody>
    </table>
  );
}`);
})();
