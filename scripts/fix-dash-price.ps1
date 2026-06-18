$c = Get-Content "src\app\dashboard\page.tsx" -Raw
$c = $c -replace 'p\.price_rrp\b', 'p.price'
Set-Content "src\app\dashboard\page.tsx" -Value $c -Encoding UTF8
Select-String -Path "src\app\dashboard\page.tsx" -Pattern "price_rrp" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
Write-Host "check done"
