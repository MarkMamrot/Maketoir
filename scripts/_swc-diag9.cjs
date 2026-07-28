const {transform}=require('next/dist/build/swc/index.js');
const fs=require('fs');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};
const content=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx','utf8');
const allLines=content.split('\n');

const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const m=e.message.match(/\d+:\d+/);console.log(name+': FAIL @'+(m?m[0]:'?')+' ->',e.message.split('\n').find(l=>l.includes('nexpected')||l.includes('Expected')));}};

// Check ALL lines 1-154 for non-ASCII hidden chars
for(let i=0;i<154;i++){
  for(let j=0;j<allLines[i].length;j++){
    const c=allLines[i].charCodeAt(j);
    if(c>127&&c!==8230){  // 8230 = ellipsis ...
      console.log('Non-ASCII at line',(i+1),'col',(j+1),'char:',JSON.stringify(allLines[i][j]),'code:',c);
    }
  }
}
// Also check in JSX section
for(let i=154;i<Math.min(200,allLines.length);i++){
  for(let j=0;j<allLines[i].length;j++){
    const c=allLines[i].charCodeAt(j);
    if(c>127&&c!==8230){
      console.log('Non-ASCII at line',(i+1),'col',(j+1),'char:',JSON.stringify(allLines[i][j]),'code:',c,'context:',allLines[i].substring(Math.max(0,j-10),j+10));
    }
  }
}

// Specifically check if there's a Unicode ... (8230) in JSX attr values
(async()=>{
  // Test 1: file header + SortArrowIcon
  await test('header+SortArrowIcon', allLines.slice(0,11).join('\n')+'\nexport function T(){return <div/>;}');
  // Test 2: Include the sortTh in a minimal component
  const sortThCode=allLines.slice(0,11).join('\n')+
    '\nexport function T({onBack}:{onBack:()=>void}){\n'+
    '  const[sortCol,setSortCol]=React.useState("x");\n'+
    '  const[sortAsc,setSortAsc]=React.useState(false);\n'+
    '  const hCell:React.CSSProperties={};\n'+
    '  const toggleSort=(col:string)=>{};\n'+
    allLines.slice(148,153).join('\n')+
    '\n  return <div/>;\n}';
  await test('sortTh in minimal', sortThCode);
  // Test 3: Just lines 1-154 + return stub
  const prefix=allLines.slice(0,154).join('\n');
  await test('full prefix+return stub', prefix+'\n  return <div/>;\n}');
})();
