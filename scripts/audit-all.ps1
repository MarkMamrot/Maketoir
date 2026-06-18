$root = "C:\Users\mark\OneDrive\Documents\GitHub\marketoir"
$files = Get-ChildItem -Path "$root\src","$root\scripts" -Recurse -Include "*.ts","*.tsx","*.mjs" | Select-Object -ExpandProperty FullName

$patterns = @('wholesale_price', 'discounted_price', 'cost_foreign_json')

foreach ($file in $files) {
  $lines = Get-Content $file -ErrorAction SilentlyContinue
  if (!$lines) { continue }
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    foreach ($pat in $patterns) {
      if ($line -match $pat) {
        $rel = $file.Replace("$root\", '')
        Write-Host "HIT $rel L$($i+1): $($line.Trim())"
      }
    }
  }
}

# Also check SQL for old column names in ImsRepository
$imsRepo = Get-Content "$root\src\lib\ims\ImsRepository.ts" -Raw
$sqlOldCols = @('`cost`', '`price`', '`wholesale_price`', '`discounted_price`', '`cost_foreign_json`', 'v\.cost\b', 'v\.price\b')
foreach ($pat in $sqlOldCols) {
  if ($imsRepo -match $pat) {
    Write-Host "SQL HIT in ImsRepository: $pat"
  }
}

Write-Host "audit complete"
