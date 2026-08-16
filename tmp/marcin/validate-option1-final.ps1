$ErrorActionPreference = 'Stop'

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$path = Join-Path $base '850DCP0036 - Part C Item 16 - IMPLEMENTED OPTION 1 FINAL.docx'
$checks = @(
    'Clause 1.1 - Defined terms / "Associated Site(s)"',
    'Clause 1.2 - Interpretation / paragraph (q)(b)',
    'Clause 14.1 Warranties',
    'Clause 16.6 Acceptance',
    'Clause 16.10 - Principal-caused delivery delay',
    'Clause 20.3 Principal',
    'Contract Particulars / Item 25 - Warranty Period',
    'Annexure I - Performance requirements and Acceptance Tests / Whole annexure',
    'Schedule 15 - Deed of Novation / Whole schedule'
)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $document = $word.Documents.Open($path, $false, $true, $false)
    try {
        $register = $document.Tables.Item(2)
        $text = (($register.Range.Text -replace '[\r\a]', ' ') -replace '\s+', ' ').Trim()
        $missing = @($checks | Where-Object { -not $text.Contains($_) })
        if ($missing.Count -gt 0) {
            throw "Missing checks: $($missing -join '; ')"
        }

        [pscustomobject]@{
            OpenedInWord = $true
            Tables = $document.Tables.Count
            Pages = $document.ComputeStatistics(2)
            Revisions = $document.Revisions.Count
            Comments = $document.Comments.Count
            RegisterCharacters = $register.Range.Text.Length
            ReferenceChecks = $checks.Count
            MissingChecks = $missing.Count
        }
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