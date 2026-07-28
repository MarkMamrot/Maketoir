const {transform}=require('next/dist/build/swc/index.js');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};
const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const ln=e.message.match(/(\d+:\d+)/g);console.log(name+': FAIL @'+(ln?ln[0]:'?')+' - '+e.message.split('\n').filter(l=>l.includes('Unexpected')||l.includes('Expected')).slice(0,2).join(' | '));}};

const fs=require('fs');
// Get specific sections from the actual file
const fullFile=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx','utf8');
const lines=fullFile.split('\n');

// Attempt 1: use actual file download section (lines 107-130) in a miniature component
const downloadSection=lines.slice(106,131).join('\n'); // downloadCsv function
console.log('--- Download section (lines 107-131) ---');
console.log(downloadSection);
console.log('--- end ---');

// Test with actual download section embedded in a simple component
const withActualDownload=`import React,{useState}from'react';
type SBDateRange={kind:'window';window:number;label:string}|{kind:'range';from:string;to:string;label:string};
export function T(){
  const[locations,setLocations]=useState<{id:number;name:string}[]>([]);
  const[displayRows,setDisplayRows]=useState<any[]>([]);
  const[page,setPage]=useState(1);
  const[pageSize,setPageSize]=useState(25);
  const[dateRange,setDateRange]=useState<SBDateRange>({kind:'window',window:90,label:'90 Days'});
  const salesKey='sales_qty_90d';
${downloadSection}
  return <div/>;
}`;

test('with-actual-downloadCsv',withActualDownload);
