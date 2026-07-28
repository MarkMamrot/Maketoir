const {transform}=require('next/dist/build/swc/index.js');
const fs=require('fs');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};
const full=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx','utf8');
const allLines=full.split('\n');
const returnSection=allLines.slice(154).join('\n');

const minimal=`import React from 'react';
export function T(){
`;
transform(minimal+returnSection,opts).then(()=>console.log('OK')).catch(e=>console.log('ERR:\n'+e.message.substring(0,800)));
