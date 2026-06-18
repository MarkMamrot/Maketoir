$c = Get-Content "src\app\pos\page.tsx" -Raw
$c = $c -replace 'product\.price_rrp\b', 'product.price'
Set-Content "src\app\pos\page.tsx" -Value $c -Encoding UTF8
Select-String -Path "src\app\pos\page.tsx" -Pattern "price_rrp" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
Write-Host "done"
