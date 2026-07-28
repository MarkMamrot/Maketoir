const {transform}=require('next/dist/build/swc/index.js');
const fs=require('fs');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};

const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const m=e.message.match(/\d+:\d+/);console.log(name+': FAIL @'+(m?m[0]:'?')+' ->',e.message.split('\n').find(l=>l.includes('nexpected')));}};

// Sanity check: does basic JSX work?
await test('basic-div',`import React from 'react';\nexport function T(){return(<div></div>);}`);

// Now test with the actual return section from the file
const content=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx','utf8');
const allLines=content.split('\n');
const returnSection=allLines.slice(154).join('\n');

// Print first 20 chars hex of the return section
console.log('Return section start hex:',Buffer.from(returnSection.substring(0,50)).toString('hex').match(/../g).join(' '));

// Test return section alone
await test('return-section-alone',`import React from 'react';\nexport function T(){\n`+returnSection);

// Binary search within return section (without prefix)
// Find first line that, when appended, causes failure
let lo=0,hi=allLines.length-154;
while(lo<hi-1){
  const mid=Math.floor((lo+hi)/2);
  // Build: just the partial return section; add a closing to make it valid
  // We can't make it valid easily, so instead: test if including all lines up to mid+155
  // causes a DIFFERENT error (parse error vs unbalanced brackets)
  const partial=`import React from 'react';\nexport function T(){\n`+allLines.slice(154,154+mid).join('\n')+'\n  return null;\n}';
  try{
    await transform(partial,opts);
    lo=mid; // partial is OK
  }catch(e){
    if(e.message.includes("Expected '}', got '<eof>")||e.message.includes('Unexpected end')){
      lo=mid; // this is an "incomplete" error, not a parse error at a specific token
    }else{
      hi=mid; // real parse error
    }
  }
}
const failLine=154+lo+1;
console.log('First problematic line in return section:',failLine);
console.log('Content:',allLines[failLine-1]);
