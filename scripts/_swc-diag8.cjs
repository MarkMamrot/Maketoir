const fs=require('fs');
const buf=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx');
const content=buf.toString('utf8');
const allLines=content.split('\n');

// Check for CRLF vs LF
const hasCRLF=content.includes('\r\n');
const hasLooseCR=content.includes('\r') && !hasCRLF;
console.log('Has CRLF:',hasCRLF,'Has loose CR:',hasLooseCR);

// Check bytes around line 156 (<div>)
const line156=allLines[155]; // 0-indexed
console.log('Line 156 repr:',JSON.stringify(line156));
console.log('Line 156 bytes (hex):',Buffer.from(line156).toString('hex').match(/../g).join(' '));

// Check if any non-ASCII chars around the return section
const returnIdx=allLines.findIndex((l,i)=>i>150 && l.includes('return ('));
console.log('return ( at line:',returnIdx+1);
const nearby=allLines.slice(returnIdx-1,returnIdx+5);
nearby.forEach((l,i)=>{
  const nonAscii=[];
  for(let j=0;j<l.length;j++){if(l.charCodeAt(j)>127)nonAscii.push({pos:j,char:l[j],code:l.charCodeAt(j)});}
  if(nonAscii.length>0)console.log('Line',(returnIdx+i),'has non-ASCII:',nonAscii);
});

// Check line 155-156 hex
[154,155,156].forEach(idx=>{
  console.log(`Line ${idx+1} hex:`,Buffer.from(allLines[idx]).toString('hex').substring(0,60));
});
