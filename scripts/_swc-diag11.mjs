import {createRequire} from 'module';
const require=createRequire(import.meta.url);
const {transform}=require('next/dist/build/swc/index.js');
const fs=require('fs');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};

const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const m=e.message.match(/\d+:\d+/);console.log(name+': FAIL @'+(m?m[0]:'?')+' ->',e.message.split('\n').find(l=>l.includes('nexpected')));}};

// Sanity check
await test('basic-div',`import React from 'react';\nexport function T(){return(<div></div>);}`);

const content=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx','utf8');
const allLines=content.split('\n');
const returnSection=allLines.slice(154).join('\n');

console.log('Return section start hex:',Buffer.from(returnSection.substring(0,50)).toString('hex').match(/../g).join(' '));

// Test the return section alone
await test('return-section-alone',`import React from 'react';\nexport function T(){\n`+returnSection);

// Binary search
let lo=0,hi=allLines.length-154;
while(lo<hi-1){
  const mid=Math.floor((lo+hi)/2);
  const partial=`import React from 'react';\nexport function T(){\n`+allLines.slice(154,154+mid).join('\n')+'\n  return null;\n}';
  try{
    await transform(partial,opts);
    lo=mid;
  }catch(e){
    if(e.message.includes("Expected '}'")||e.message.includes('Unexpected end')||e.message.includes("'<eof>'")){
      lo=mid;
    }else{
      hi=mid;
    }
  }
}
const failLine=154+lo+1;
console.log('First problematic line:',failLine);
console.log('Content:',allLines[failLine-1]);
