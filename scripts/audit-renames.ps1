$files = @(
  "src\app\ims\page.tsx",
  "src\app\api\ims\products\bulk-import\route.ts",
  "src\app\api\ims\shopify\sync-prices\route.ts",
  "src\app\api\ims\shopify\upload\route.ts",
  "src\app\api\ims\sync\route.ts",
  "src\app\api\ims\reports\inventory-valuation\route.ts",
  "src\lib\ims\ImsRepository.ts",
  "src\lib\adapters\imsAdapter.ts"
)
foreach ($file in $files) {
  if (!(Test-Path $file)) { continue }
  $hits = Get-Content $file | Select-String -Pattern 'wholesale_price|discounted_price|cost_foreign_json'
  if ($hits) {
    $hits | ForEach-Object { "ISSUE $file L$($_.LineNumber): $($_.Line.Trim())" }
  }
}
Write-Host "scan done - no issues = all clean"
