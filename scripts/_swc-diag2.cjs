const {transform}=require('next/dist/build/swc/index.js');
const opts={filename:'test.tsx',jsc:{parser:{syntax:'typescript',tsx:true},target:'es2017'},module:{type:'commonjs'}};
const test=async(name,code)=>{try{await transform(code,opts);console.log(name+': OK');}catch(e){const m=e.message.match(/\d+:\d+/);console.log(name+': FAIL @'+(m?m[0]:'?'));}};

// Base that we KNOW works
const base=`import React,{useState,useCallback}from'react';
import{SBDatePicker,SBDateRange}from'./reportFilterHelpers';
function SortArrowIcon({col,sortCol,sortAsc}:{col:string;sortCol:string;sortAsc:boolean}){return(<span>{sortCol===col?(sortAsc?'\\u25B2':'\\u25BC'):'\\u2195'}</span>);}
interface Props{onBack:()=>void;apiFetch:(url:string,opts?:RequestInit)=>Promise<any>;}
export function SalesByBranchView({onBack,apiFetch}:Props){
`;

const stateLines=`  const[rows,setRows]=useState<any[]>([]);
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
`;

const loadFn=`  const load=useCallback(async(pg:number,ft:string,fb:string,fs_:string,ftype:string,dr:SBDateRange,ps:number,bid:number|null=null)=>{
    setLoading(true);setError('');
    try{const params=new URLSearchParams({page:String(pg),pageSize:String(ps)});if(ft)params.set('q',ft);if(fb)params.set('brand',fb);if(fs_)params.set('supplierName',fs_);if(ftype)params.set('productType',ftype);if(dr.kind==='window'){params.set('window',String(dr.window));}else{params.set('from',dr.from);params.set('to',dr.to);}if(bid)params.set('locationIds',String(bid));const data=await apiFetch('/api/ims/reports/sales-by-branch?'+params);setRows(data.rows??[]);setTotal(data.total??0);setLocations(data.locations??[]);if(data.brands)setBrandsOptions(data.brands);if(data.suppliers)setSuppliersOptions(data.suppliers);}catch(e:any){setError(e.message??'Failed');}finally{setLoading(false);}
  },[apiFetch]);
`;

const handlers=`  const handleDateChange=(dr:SBDateRange)=>{setDateRange(dr);setPage(1);load(1,filterText,filterBrand,filterSupplier,filterType,dr,pageSize,branchFilter);};
  const handleBranchChange=(bid:number|null)=>{setBranchFilter(bid);setPage(1);load(1,filterText,filterBrand,filterSupplier,filterType,dateRange,pageSize,bid);};
  const goPage=(pg:number)=>{setPage(pg);load(pg,filterText,filterBrand,filterSupplier,filterType,dateRange,pageSize,branchFilter);};
  const changePageSize=(ps:number)=>{setPageSize(ps);setPage(1);load(1,filterText,filterBrand,filterSupplier,filterType,dateRange,ps,branchFilter);};
  const salesKey=dateRange.kind==='range'?'sales_qty_custom':dateRange.window<=7?'sales_qty_7d':dateRange.window<=90?'sales_qty_90d':dateRange.window<=180?'sales_qty_180d':'sales_qty_12m';
  const toggleSort=(col:string)=>{if(sortCol===col)setSortAsc(a=>!a);else{setSortCol(col);setSortAsc(false);}};
`;

const displayRowsFn=`  const displayRows=React.useMemo(()=>{
    let r=[...rows];const dir=sortAsc?1:-1;
    r.sort((a,b)=>{
      let av:number|string=0,bv:number|string=0;
      if(sortCol==='sales'){av=Number(a[salesKey]??0);bv=Number(b[salesKey]??0);}
      else if(sortCol==='soh'){av=Number(a.global_soh??0);bv=Number(b.global_soh??0);}
      else if(sortCol==='product'){av=(a.product_name??'')+(a.option_label??'');bv=(b.product_name??'')+(b.option_label??'');}
      else if(sortCol==='sku'){av=a.sku??'';bv=b.sku??'';}
      else if(sortCol==='brand'){av=a.brand??'';bv=b.brand??'';}
      else if(sortCol==='supplier'){av=a.supplier_name??'';bv=b.supplier_name??'';}
      else if(sortCol.startsWith('loc_')){const lid=Number(sortCol.slice(4));av=Number(a.stock?.find((s:any)=>s.location_id===lid)?.soh??0);bv=Number(b.stock?.find((s:any)=>s.location_id===lid)?.soh??0);}
      if(typeof av==='number'&&typeof bv==='number')return(av-bv)*dir;
      return String(av).localeCompare(String(bv))*dir;
    });return r;
  },[rows,sortCol,sortAsc,salesKey]);
`;

const downloadFn=`  const downloadCsv=()=>{
    const locHeaders=locations.map(l=>l.name);
    const headers=['#','Product','Option','SKU','Brand','Supplier','Sales ('+dateRange.label+')','Global SOH',...locHeaders];
    const lines=[headers.map(h=>'"'+h+'"').join(',')];
    displayRows.forEach((row,i)=>{
      const sq=Number(row[salesKey]??0);
      const locCols=locations.map(l=>{const s=row.stock?.find((x:any)=>x.location_id===l.id);return String(s?Number(s.soh):0);});
      lines.push([String((page-1)*pageSize+i+1),'"'+(row.product_name||'').replace(/"/g,'""')+'"','"'+(row.option_label||'').replace(/"/g,'""')+'"','"'+(row.sku||'').replace(/"/g,'""')+'"','"'+(row.brand||'').replace(/"/g,'""')+'"','"'+(row.supplier_name||'').replace(/"/g,'""')+'"',String(sq),String(Number(row.global_soh??0)),...locCols].join(','));
    });
    const blob=new Blob([lines.join('\n')],{type:'text/csv'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
    a.download='sales-by-branch-'+new Date().toLocaleDateString('sv-SE')+'.csv';a.click();URL.revokeObjectURL(url);
  };
`;

const pageRangeFn=`  const pageRange=()=>{
    const r:(number|'...')[]=[]; 
    if(totalPages<=7){for(let i=1;i<=totalPages;i++)r.push(i);}
    else{r.push(1);if(page>3)r.push('...');for(let i=Math.max(2,page-1);i<=Math.min(totalPages-1,page+1);i++)r.push(i);if(page<totalPages-2)r.push('...');r.push(totalPages);}
    return r;
  };
`;

const styleDefs=`  const cellStyle:React.CSSProperties={padding:'9px 12px',borderBottom:'1px solid var(--sv-etch)',fontSize:13,whiteSpace:'nowrap'};
  const hCell:React.CSSProperties={...cellStyle,fontWeight:600,color:'var(--sv-text-dim)',fontSize:11,textTransform:'uppercase',letterSpacing:0.6,background:'var(--sv-bg-2)',verticalAlign:'top',position:'sticky',top:0,zIndex:2};
  const numCell:React.CSSProperties={...cellStyle,textAlign:'right'};
  const numHCell:React.CSSProperties={...hCell,textAlign:'right'};
`;

const sortThFn=`  const sortTh=(col:string,label:string,extra?:React.CSSProperties)=>(
    <th onClick={()=>toggleSort(col)} style={{...hCell,cursor:'pointer',userSelect:'none',...extra}}>
      {label}<SortArrowIcon col={col} sortCol={sortCol} sortAsc={sortAsc}/>
    </th>
  );
`;

const returnStub=`  return <div/>;
}`;

(async()=>{
  await test('base+state',base+stateLines+returnStub);
  await test('+load',base+stateLines+loadFn+returnStub);
  await test('+handlers',base+stateLines+loadFn+handlers+returnStub);
  await test('+displayRows',base+stateLines+loadFn+handlers+displayRowsFn+returnStub);
  await test('+download',base+stateLines+loadFn+handlers+displayRowsFn+downloadFn+returnStub);
  await test('+pageRange',base+stateLines+loadFn+handlers+displayRowsFn+downloadFn+pageRangeFn+returnStub);
  await test('+styles',base+stateLines+loadFn+handlers+displayRowsFn+downloadFn+pageRangeFn+styleDefs+returnStub);
  await test('+sortTh',base+stateLines+loadFn+handlers+displayRowsFn+downloadFn+pageRangeFn+styleDefs+sortThFn+returnStub);
})();
