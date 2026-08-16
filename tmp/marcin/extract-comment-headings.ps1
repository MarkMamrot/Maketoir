$ErrorActionPreference = 'Stop'

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$documentPath = Join-Path $base '850DCP0036- Part D - Draft Contract (Draft)_RFT 14.08.2026_EMOB Redlines.docx'
$outputPath = Join-Path $base 'comment-headings.json'

function Clean-Text([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }
    return ($text -replace "[\r\a]", ' ' -replace "\s+", ' ').Trim()
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $document = $word.Documents.Open($documentPath, $false, $true, $false)
    try {
        $records = @()
        for ($commentIndex = 1; $commentIndex -le $document.Comments.Count; $commentIndex++) {
            $scope = $document.Comments.Item($commentIndex).Scope
            $cursor = $scope.Paragraphs.Item(1)
            $heading1 = $null
            $heading2 = $null
            $steps = 0

            while ($null -ne $cursor -and $steps -lt 500 -and ($null -eq $heading1 -or $null -eq $heading2)) {
                $style = ''
                try { $style = [string]$cursor.Range.Style.NameLocal } catch {}
                if ($null -eq $heading2 -and $style -eq 'Heading 2') {
                    $list = ''
                    try { $list = [string]$cursor.Range.ListFormat.ListString } catch {}
                    $heading2 = [ordered]@{ list = $list; text = Clean-Text $cursor.Range.Text }
                }
                if ($null -eq $heading1 -and $style -eq 'Heading 1') {
                    $list = ''
                    try { $list = [string]$cursor.Range.ListFormat.ListString } catch {}
                    $heading1 = [ordered]@{ list = $list; text = Clean-Text $cursor.Range.Text }
                }
                try { $cursor = $cursor.Previous() } catch { $cursor = $null }
                $steps++
            }

            $records += [ordered]@{
                index = $commentIndex
                page = [int]$scope.Information(3)
                heading1 = $heading1
                heading2 = $heading2
            }
        }
        $records | ConvertTo-Json -Depth 8 | Set-Content $outputPath -Encoding UTF8
    }
    finally {
        $document.Close($false)
    }
}
finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}

Write-Host "Created $outputPath"