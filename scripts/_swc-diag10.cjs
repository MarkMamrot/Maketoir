const fs=require('fs');
const content=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx','utf8');
const allLines=content.split('\n');

// Check every line in the return section for non-ASCII chars
console.log('=== Non-ASCII chars in return section ===');
let found=0;
for(let i=154;i<allLines.length;i++){
  const line=allLines[i];
  for(let j=0;j<line.length;j++){
    const c=line.charCodeAt(j);
    if(c>127){
      console.log(`Line ${i+1}, col ${j+1}: U+${c.toString(16).padStart(4,'0')} '${line[j]}' context: ...${line.substring(Math.max(0,j-15),j+15)}...`);
      found++;
    }
  }
}
if(found===0) console.log('No non-ASCII chars found in return section');

// Check lines 155-160 hex
console.log('\n=== Hex for lines 155-162 ===');
for(let i=154;i<162&&i<allLines.length;i++){
  const hex=Buffer.from(allLines[i]).toString('hex').match(/../g)||[];
  console.log(`Line ${i+1}: ${hex.slice(0,30).join(' ')} ${allLines[i].substring(0,30)}`);
}
