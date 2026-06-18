$file = "src\lib\ims\ImsRepository.ts"
$lines = Get-Content $file
for ($i = 0; $i -lt $lines.Count; $i++) {
  $l = $lines[$i]
  # look for bare 'cost' or 'price' not part of longer names
  if ($l -match '\bcost\b' -and $l -notmatch 'avg_cost|unit_cost|unit_price|landed_cost|cost_aud|price_rrp|price_wholesale|price_rrp_sale|price_positioning|true_cost|cost_foreign|lcpu|cost:.*Number|cost_rate|cost_type') {
    Write-Host "COST L$($i+1): $($l.Trim())"
  }
  if ($l -match '\bprice\b' -and $l -notmatch 'unit_price|price_rrp|price_wholesale|price_rrp_sale|price_positioning|compare_at_price|price:.*String|price_tier|price_list|price_type') {
    Write-Host "PRICE L$($i+1): $($l.Trim())"
  }
}
Write-Host "done"
