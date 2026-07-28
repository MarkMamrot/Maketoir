const {transform}=require('next/dist/build/swc/index.js');
const fs=require('fs');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};
const full=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx','utf8');
const allLines=full.split('\n');
const returnSection=allLines.slice(154).join('\n'); // from 'return ('

const minimal=`import React,{useState,useCallback}from'react';
import{SBDatePicker,SBDateRange}from'./reportFilterHelpers';
function SortArrowIcon(p:any){return<span/>;}
export function T({onBack,apiFetch}:{onBack:()=>void,apiFetch:(u:string)=>Promise<any>}){
  const[rows]=useState<any[]>([]);const[total]=useState(0);
  const[locations]=useState<{id:number;name:string}[]>([]);
  const[loading]=useState(false);const[error]=useState('');
  const[filterText]=useState('');const[filterBrand]=useState('');
  const[filterSupplier]=useState('');const[filterType]=useState('');
  const[brandsOptions]=useState<string[]>([]);
  const[suppliersOptions]=useState<{id:number;name:string}[]>([]);
  const[dateRange]=useState<SBDateRange>({kind:'window',window:90,label:'90'});
  const[page]=useState(1);const[pageSize]=useState(25);
  const[branchFilter]=useState<number|null>(null);
  const[sortCol]=useState('sales');const[sortAsc]=useState(false);
  const totalPages=1;const salesKey='x';const displayRows:any[]=[];
  const handleDateChange=(d:SBDateRange)=>{};const handleBranchChange=(b:number|null)=>{};
  const load=(a:any)=>{};const goPage=(p:number)=>{};const changePageSize=(p:number)=>{};
  const sortArrow=(col:string)=><span/>;const toggleSort=(col:string)=>{};
  const downloadCsv=()=>{};const pageRange=():[number|'...'][]=()=>[];
  const cellStyle:React.CSSProperties={};const hCell:React.CSSProperties={};
  const numCell:React.CSSProperties={};const numHCell:React.CSSProperties={};
  const sortTh=(col:string,label:string,extra?:React.CSSProperties)=><th/>;
`;
const code=minimal+returnSection;

const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const m=e.message.split('\n').filter(l=>l.includes('nexpected')||l.includes('xpected')).slice(0,2).join(' | ');console.log(name+': FAIL ->',m);}};

(async()=>{
  await test('return-in-minimal',code);
  // Also test WITHOUT sortArrow (use SortArrowIcon instead)
  const returnFixed=returnSection
    .replace(/\{sortArrow\('sales'\)\}/g, '<SortArrowIcon col="sales" sortCol={sortCol} sortAsc={sortAsc}/>')
    .replace(/\{sortArrow\('soh'\)\}/g, '<SortArrowIcon col="soh" sortCol={sortCol} sortAsc={sortAsc}/>')
    .replace(/\{sortArrow\(`loc_\$\{l\.id\}`\)\}/g, '<SortArrowIcon col={`loc_${l.id}`} sortCol={sortCol} sortAsc={sortAsc}/>');
  await test('return-with-sortArrow-fixed',minimal+returnFixed);
})();
