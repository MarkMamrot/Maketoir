const {transform}=require('next/dist/build/swc/index.js');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};
const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const ln=e.message.match(/(\d+:\d+)/g);console.log(name+': FAIL @'+(ln?ln[0]:'?')+' - '+e.message.split('\n').filter(l=>l.includes('Unexpected')||l.includes('Expected')||l.includes('got')).slice(0,2).join(' | '));}};

const fs=require('fs');
const fullFile=fs.readFileSync('src/app/ims/views/reports/SalesByBranchView.tsx','utf8');
const allLines=fullFile.split('\n');

// Rebuild incrementally using ACTUAL file lines
// Find where each section starts
const findLine=(searchStr)=>allLines.findIndex(l=>l.includes(searchStr));

const downloadStart=findLine('const downloadCsv = ()');
const pageRangeStart=findLine('const pageRange = ()');
const styleDefs=findLine('const cellStyle: React.CSSProperties');
const sortThStart=findLine('const sortTh =');
const returnStart=findLine('return (');

console.log(`Lines: downloadCsv=${downloadStart+1}, pageRange=${pageRangeStart+1}, cellStyle=${styleDefs+1}, sortTh=${sortThStart+1}, return=${returnStart+1}`);

// Extract each section from the actual file
const downloadSection=allLines.slice(downloadStart,pageRangeStart).join('\n');
const pageRangeSection=allLines.slice(pageRangeStart,styleDefs).join('\n');
const styleSection=allLines.slice(styleDefs,sortThStart).join('\n');
const sortThSection=allLines.slice(sortThStart,returnStart).join('\n');

// Build a component base
const base=`import React,{useState,useCallback}from'react';
import{SBDatePicker,SBDateRange}from'./reportFilterHelpers';
function SortArrowIcon({col,sortCol,sortAsc}:{col:string;sortCol:string;sortAsc:boolean}){return<span/>;}
export function SalesByBranchView({onBack,apiFetch}:{onBack:()=>void;apiFetch:(url:string,opts?:RequestInit)=>Promise<any>}){
  const[rows,setRows]=useState<any[]>([]);
  const[total,setTotal]=useState(0);
  const[locations,setLocations]=useState<{id:number;name:string}[]>([]);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState('');
  const[filterText,setFilterText]=useState('');
  const[filterBrand,setFilterBrand]=useState('');
  const[filterSupplier,setFilterSupplier]=useState('');
  const[filterType,setFilterType]=useState('');
  const[brandsOptions,setBrandsOptions]=useState<string[]>([]);
  const[suppliersOptions,setSuppliersOptions]=useState<{id:number;name:string}[]>([]);
  const[dateRange,setDateRange]=useState<SBDateRange>({kind:'window',window:90,label:'90 Days'});
  const[page,setPage]=useState(1);
  const[pageSize,setPageSize]=useState(25);
  const[branchFilter,setBranchFilter]=useState<number|null>(null);
  const[sortCol,setSortCol]=useState<string>('sales');
  const[sortAsc,setSortAsc]=useState(false);
  const totalPages=Math.ceil(total/pageSize)||1;
  const load=useCallback(async(pg:number,ft:string,fb:string,fs_:string,ftype:string,dr:SBDateRange,ps:number,bid:number|null=null)=>{
    setLoading(true);
  },[apiFetch]);
  const salesKey=dateRange.kind==='range'?'sales_qty_custom':'sales_qty_90d';
  const toggleSort=(col:string)=>{if(sortCol===col)setSortAsc(a=>!a);else setSortCol(col);};
  const displayRows=React.useMemo(()=>rows,[rows,sortCol,sortAsc,salesKey]);
`;
const returnStub=`  return <div/>;
}`;

(async()=>{
  await test('base',base+returnStub);
  await test('base+download',base+downloadSection+'\n'+returnStub);
  await test('base+download+pageRange',base+downloadSection+'\n'+pageRangeSection+'\n'+returnStub);
  await test('base+download+pageRange+styles',base+downloadSection+'\n'+pageRangeSection+'\n'+styleSection+'\n'+returnStub);
  await test('base+download+pageRange+styles+sortTh',base+downloadSection+'\n'+pageRangeSection+'\n'+styleSection+'\n'+sortThSection+'\n'+returnStub);
})();
