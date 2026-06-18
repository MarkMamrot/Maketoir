$c = Get-Content "src\app\dashboard\OrderPlannerView.tsx" -Raw
$c = $c -replace 'row\.cost_aud\b', 'row.cost'
Set-Content "src\app\dashboard\OrderPlannerView.tsx" -Value $c -Encoding UTF8

# Fix dashboard/page.tsx InactiveCandidate + LostCandidate + ShopifyProduct
$c2 = Get-Content "src\app\dashboard\page.tsx" -Raw
$c2 = $c2 -replace 'c\.cost_aud\b', 'c.cost'
Set-Content "src\app\dashboard\page.tsx" -Value $c2 -Encoding UTF8

Write-Host "done"
