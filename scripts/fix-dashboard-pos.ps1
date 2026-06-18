$files = @(
  "src\app\pos\page.tsx",
  "src\app\dashboard\page.tsx",
  "src\app\dashboard\OrderPlannerView.tsx",
  "src\app\dashboard\StockTurnoverView.tsx"
)
foreach ($file in $files) {
  if (Test-Path $file) {
    $c = Get-Content $file -Raw
    $c = $c -replace 'product\.price\b', 'product.price_rrp'
    $c = $c -replace 'p\.price\b', 'p.price_rrp'
    $c = $c -replace 'c\.cost\b', 'c.cost_aud'
    $c = $c -replace 'p\.cost\b', 'p.cost_aud'
    $c = $c -replace 'row\.cost\b', 'row.cost_aud'
    $c = $c -replace 'r\.cost\b', 'r.cost_aud'
    Set-Content $file -Value $c -Encoding UTF8
    Write-Host "OK: $file"
  } else {
    Write-Host "SKIP: $file"
  }
}
