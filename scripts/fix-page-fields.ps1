$c = Get-Content "src\app\ims\page.tsx" -Raw
$c = $c -replace '\.cost_foreign_json\b', '.cost_foreign'
$c = $c -replace 'cost_foreign_json', 'cost_foreign'
$c = $c -replace 'v\.wholesale_price\b', 'v.price_wholesale'
$c = $c -replace 'row\.wholesale_price\b', 'row.price_wholesale'
$c = $c -replace 'v\.discounted_price\b', 'v.price_rrp_sale'
$c = $c -replace 'row\.discounted_price\b', 'row.price_rrp_sale'
$c = $c -replace "'wholesale_price'", "'price_wholesale'"
$c = $c -replace "'discounted_price'", "'price_rrp_sale'"
$c = $c -replace 'wholesale_price:', 'price_wholesale:'
$c = $c -replace 'discounted_price:', 'price_rrp_sale:'
$c = $c -replace 'v\.cost\b', 'v.cost_aud'
$c = $c -replace 'row\.cost\b', 'row.cost_aud'
$c = $c -replace 'v\.price\b', 'v.price_rrp'
$c = $c -replace 'row\.price\b', 'row.price_rrp'
Set-Content "src\app\ims\page.tsx" -Value $c -Encoding UTF8
Write-Host "page.tsx field rename done"
