param(
    [switch]$LedgerOnly
)

$ErrorActionPreference = 'Stop'

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$templatePath = Join-Path $base '850DCP0036 - Part C, Item 16 (Commercial Clarification Register) 1.docx'
$outputPath = Join-Path $base '850DCP0036 - Part C Item 16 - IMPLEMENTED OPTION 1.docx'
$analysisPath = Join-Path $base 'part-d-targeted-analysis.json'
$wordingPath = Join-Path $base 'comment-wording.json'
$headingsPath = Join-Path $base 'comment-headings.json'
$ledgerPath = Join-Path $base 'OPTION-1-REGISTER-LEDGER.json'

$analysis = Get-Content $analysisPath -Raw | ConvertFrom-Json
$wordingData = Get-Content $wordingPath -Raw | ConvertFrom-Json
$wording = @($wordingData.PSObject.BaseObject | Sort-Object commentId)
$headingData = Get-Content $headingsPath -Raw | ConvertFrom-Json
$headingRecords = @($headingData.PSObject.BaseObject | Sort-Object index)
$comments = @($analysis.commentAnchors | Sort-Object index)

if ($comments.Count -ne 92 -or $wording.Count -ne 92) {
    throw "Expected 92 comments and wording records; found comments=$($comments.Count), wording=$($wording.Count)."
}

function Clean-Text([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }
    return ($text -replace "[\r\a]", ' ' -replace "\s+", ' ').Trim()
}

function Get-HeadingLabel($heading) {
    if ($null -eq $heading) { return '' }
    return ("$($heading.list) $($heading.text)").Trim()
}

$currentHeading1 = $null
$currentHeading2 = $null
$commentRecords = @()

foreach ($comment in $comments) {
    $headings = @($comment.precedingParagraphs | Where-Object { $_.style -match '^Heading' })
    $nearestHeading1 = $headings | Where-Object { $_.style -eq 'Heading 1' } | Select-Object -Last 1
    $nearestHeading2 = $headings | Where-Object { $_.style -eq 'Heading 2' } | Select-Object -Last 1

    if ($null -ne $nearestHeading1) {
        $newHeading1 = Get-HeadingLabel $nearestHeading1
        if ($null -eq $currentHeading1 -or (Get-HeadingLabel $currentHeading1) -ne $newHeading1) {
            $currentHeading2 = $null
        }
        $currentHeading1 = $nearestHeading1
    }
    if ($null -ne $nearestHeading2) { $currentHeading2 = $nearestHeading2 }

    if ($comment.paragraphStyle -eq 'Heading 1') {
        $currentHeading1 = [pscustomobject]@{ list = $comment.paragraphList; text = $comment.paragraphText }
        $currentHeading2 = $null
    }
    elseif ($comment.paragraphStyle -eq 'Heading 2') {
        $currentHeading2 = [pscustomobject]@{ list = $comment.paragraphList; text = $comment.paragraphText }
    }

    $index = [int]$comment.index
    $reference = ''
    $headingRecord = $headingRecords[$index - 1]
    $accurateHeading2 = ("$($headingRecord.heading2.list) $($headingRecord.heading2.text)").Trim()

    switch ($index) {
        1 { $reference = 'Clause 1.1 - Defined terms / "Acceptance" / paragraph (b)' }
        2 { $reference = 'Clause 1.1 - Defined terms / "Acceptance" / paragraph (d)' }
        3 { $reference = 'Clause 1.1 - Defined terms / "Associated Site(s)"' }
        4 { $reference = 'Clause 1.1 - Defined terms / "Defect"' }
        5 { $reference = 'Clause 1.1 - Defined terms / "Force Majeure Event" / paragraph (a)' }
        6 { $reference = 'Clause 1.1 - Defined terms / "Good Industry Practice" / paragraph (e)' }
        7 { $reference = 'Clause 1.1 - Defined terms / "Gross Negligence"' }
        8 { $reference = 'Clause 1.1 - Defined terms / "Loss"' }
        9 { $reference = 'Clause 1.1 - Defined terms / "Parent Company Guarantee"' }
        10 { $reference = 'Clause 1.1 - Defined terms / "Project IP"' }
        11 { $reference = 'Clause 1.1 - Defined terms / "Wilful Default" / paragraph (a)' }
        12 { $reference = 'Clause 1.2 - Interpretation / paragraph (q)(b)' }
        30 { $reference = 'Clause 10.3 - Use of Supplier''s Background IP / paragraph (a)' }
        45 { $reference = 'Clause 16.10 - Principal-caused delivery delay (proposed new clause)' }
        67 { $reference = 'Clause 32 - Local content' }
        72 { $reference = 'Contract Particulars / Item 10 - Payment Method / Rise and fall adjustment' }
        73 { $reference = 'Contract Particulars / Item 12 - Percentage adjustments for valuing a Variation' }
        74 { $reference = 'Contract Particulars / Item 25 - Warranty Period' }
        75 { $reference = 'Contract Particulars / Item 29 - Professional Indemnity Insurance' }
        76 { $reference = 'Schedule 2 - Supply Order Template / Annexure C - Pricing Annexure / Tariff and Duties' }
        77 { $reference = 'Annexure I - Performance requirements and Acceptance Tests / Whole annexure' }
        78 { $reference = 'Annexure I - Performance requirements and Acceptance Tests / Whole annexure' }
        79 { $reference = 'Annexure I - Performance requirements and Acceptance Tests / Whole annexure' }
        80 { $reference = 'Schedule 3 - Pricing Schedule / Whole schedule' }
        81 { $reference = 'Schedule 3 - Pricing Schedule / Whole schedule' }
        82 { $reference = 'Schedule 3 - Pricing Schedule / Item 6 - Applicable Milestones for each Supply Order / Table 3-1 - Framework Milestones for each Supply Order' }
        83 { $reference = 'Schedule 3 - Pricing Schedule / Item 1 - Applicable Rise and Fall Formula' }
        84 { $reference = 'Schedule 7 - Form of Parent Company Guarantee / Whole schedule (proposed Not Used)' }
        85 { $reference = 'Schedule 8 - Form of Security / Whole schedule' }
        86 { $reference = 'Schedule 8 - Form of Security / Whole schedule' }
        87 { $reference = 'Schedule of Insurances / General Third Party (Public & Products) Liability / Deductibles' }
        88 { $reference = 'Schedule of Insurances / General Third Party (Public & Products) Liability / Additional requirements' }
        89 { $reference = 'Schedule of Insurances / Marine Transit Insurance / Deductibles' }
        90 { $reference = 'Schedule 11 - Subcontractor Warranty / Whole schedule (proposed Not Used)' }
        91 { $reference = 'Schedule 12 - Review Procedures / Whole schedule' }
        92 { $reference = 'Schedule 15 - Deed of Novation / Whole schedule' }
        default {
            if ($accurateHeading2 -and $accurateHeading2 -notmatch '^(Schedule|Annexure|and$)') {
                $reference = "Clause $accurateHeading2"
            }
            else {
                $reference = "Part D / page $($comment.page)"
            }

            $paragraphList = Clean-Text $comment.paragraphList
            if ($paragraphList -and $reference -notmatch [regex]::Escape($paragraphList) -and $comment.paragraphStyle -notmatch '^Heading') {
                $reference += " / paragraph $paragraphList"
            }
        }
    }

    $wordingRecord = $wording[$index - 1]
    $commentRecords += [pscustomobject]@{
        index = $index
        commentId = [int]$wordingRecord.commentId
        scopeStart = [int]$comment.scopeStart
        page = [int]$comment.page
        reference = $reference
        currentText = Clean-Text $wordingRecord.currentText
        proposedText = Clean-Text $wordingRecord.proposedText
        scopeText = Clean-Text $comment.scopeText
        commentText = Clean-Text $comment.commentText
    }
}

$internalCommentIndexes = @(77, 78, 79, 80, 81, 85, 86)
$groups = @($commentRecords | Group-Object scopeStart | Sort-Object { [int]$_.Group[0].index })
$entries = @()
$itemNumber = 0

foreach ($group in $groups) {
    $itemNumber++
    $records = @($group.Group | Sort-Object index)
    $first = $records[0]
    $isInternal = @($records | Where-Object { $_.index -in $internalCommentIndexes }).Count -gt 0
    $currentTexts = @($records.currentText | Where-Object { $_ } | Select-Object -Unique)
    $proposedTexts = @($records.proposedText | Where-Object { $_ } | Select-Object -Unique)
    $reasons = @($records | ForEach-Object { "Comment $($_.index): $($_.commentText)" })

    if ($isInternal) {
        $clarification = "INTERNAL ACTION - REVIEW BEFORE EXTERNAL ISSUE:`r`n" + ($reasons -join "`r`n`r`n")
        if ($first.scopeText) { $clarification += "`r`n`r`nAffected part:`r`n$($first.scopeText)" }
    }
    else {
        $currentText = $currentTexts -join "`r`n`r`n"
        $proposedText = $proposedTexts -join "`r`n`r`n"

        if ($currentText -and -not $proposedText) {
            $amendment = "Delete the following wording in full:`r`n$currentText"
        }
        elseif (-not $currentText -and $proposedText) {
            $amendment = "Insert the following wording:`r`n$proposedText"
        }
        elseif ($currentText -and $proposedText -and $currentText -ne $proposedText) {
            $amendment = "Replace:`r`n$currentText`r`n`r`nWith:`r`n$proposedText"
        }
        elseif ($proposedText) {
            $amendment = "Proposed wording:`r`n$proposedText"
        }
        else {
            $amendment = "Affected wording or part:`r`n$($first.scopeText)"
        }

        $clarification = "Proposed amendment:`r`n$amendment`r`n`r`nReason:`r`n" + ($reasons -join "`r`n`r`n")
    }

    $entries += [pscustomobject]@{
        itemNumber = $itemNumber
        sourceCommentIndexes = @($records.index)
        sourceCommentIds = @($records.commentId)
        sourcePages = @($records.page | Select-Object -Unique)
        sectionClause = $first.reference
        date = '14 Aug 2026'
        commentBy = 'Tenderer'
        clarification = $clarification
        status = 'Open'
        internalAction = $isInternal
    }
}

if ($entries.Count -ne 88) {
    throw "Expected 88 consolidated Option 1 entries; found $($entries.Count)."
}

$entries | ConvertTo-Json -Depth 8 | Set-Content $ledgerPath -Encoding UTF8
if ($LedgerOnly) {
    Write-Host "Created $ledgerPath"
    return
}
Copy-Item $templatePath $outputPath -Force

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $document = $word.Documents.Open($outputPath, $false, $false, $false)
    try {
        if ($document.Tables.Count -lt 6) { throw "Unexpected Part C table count: $($document.Tables.Count)." }

        $templateTable = $document.Tables.Item(2)
        $columnWidths = @()
        for ($column = 1; $column -le 6; $column++) {
            $columnWidths += [double]$templateTable.Cell(1, $column).Width
        }
        $fontName = [string]$templateTable.Cell(1, 1).Range.Font.Name
        $fontSize = [single]$templateTable.Cell(1, 1).Range.Font.Size
        if ($fontSize -le 0) { $fontSize = 8 }

        for ($tableIndex = 5; $tableIndex -ge 2; $tableIndex--) {
            $document.Tables.Item($tableIndex).Delete()
        }

        $signatureTable = $document.Tables.Item(2)
        $insertRange = $document.Range($signatureTable.Range.Start, $signatureTable.Range.Start)
        $rowCount = 1 + ($entries.Count * 3)
        $table = $document.Tables.Add($insertRange, $rowCount, 6)
        $table.AllowAutoFit = 0
        $table.Borders.Enable = 1
        $table.Range.Font.Name = $fontName
        $table.Range.Font.Size = $fontSize

        for ($column = 1; $column -le 6; $column++) {
            $table.Columns.Item($column).Width = $columnWidths[$column - 1]
        }

        $headers = @('Item No.', 'Section / Clause', 'Date', 'Comment By', 'Clarification', 'Status (Open/Closed)')
        for ($column = 1; $column -le 6; $column++) {
            $cell = $table.Cell(1, $column)
            $cell.Range.Text = $headers[$column - 1]
            $cell.Range.Font.Bold = 1
            $cell.Range.ParagraphFormat.Alignment = 1
            $cell.VerticalAlignment = 1
            $cell.Shading.BackgroundPatternColor = 14277081
        }
        $table.Rows.Item(1).HeadingFormat = -1
        $table.Rows.Item(1).AllowBreakAcrossPages = 0

        foreach ($entry in $entries) {
            $startRow = 2 + (($entry.itemNumber - 1) * 3)
            $middleRow = $startRow + 1
            $endRow = $startRow + 2

            $table.Cell($startRow, 1).Range.Text = [string]$entry.itemNumber
            $table.Cell($startRow, 2).Range.Text = $entry.sectionClause
            $table.Cell($startRow, 3).Range.Text = $entry.date
            $table.Cell($startRow, 4).Range.Text = 'Tenderer'
            $table.Cell($startRow, 5).Range.Text = $entry.clarification
            $table.Cell($startRow, 6).Range.Text = $entry.status

            $table.Cell($middleRow, 4).Range.Text = 'Fortescue'
            $table.Cell($endRow, 4).Range.Text = 'Tenderer'

            foreach ($row in @($startRow, $middleRow, $endRow)) {
                $table.Rows.Item($row).AllowBreakAcrossPages = 0
                for ($column = 1; $column -le 6; $column++) {
                    $table.Cell($row, $column).VerticalAlignment = 1
                }
            }

            $table.Cell($startRow, 1).Range.ParagraphFormat.Alignment = 1
            $table.Cell($startRow, 2).Range.ParagraphFormat.Alignment = 0
            $table.Cell($startRow, 3).Range.ParagraphFormat.Alignment = 1
            $table.Cell($startRow, 4).Range.ParagraphFormat.Alignment = 1
            $table.Cell($startRow, 5).Range.ParagraphFormat.Alignment = 0
            $table.Cell($startRow, 6).Range.ParagraphFormat.Alignment = 1

            if ($entry.internalAction) {
                for ($row = $startRow; $row -le $endRow; $row++) {
                    foreach ($cell in $table.Rows.Item($row).Cells) {
                        $cell.Range.Font.Color = 255
                    }
                }
            }
        }

        $document.Save()
    }
    finally {
        $document.Close($true)
    }
}
finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}

Add-Type -AssemblyName System.IO.Compression
$archive = [System.IO.Compression.ZipFile]::Open($outputPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $archive.GetEntry('word/document.xml')
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try { $xmlText = $reader.ReadToEnd() } finally { $reader.Dispose() }

    $xml = New-Object System.Xml.XmlDocument
    $xml.PreserveWhitespace = $true
    $xml.LoadXml($xmlText)
    $wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    $namespaceManager = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $namespaceManager.AddNamespace('w', $wordNamespace)
    $registerTable = $xml.SelectNodes('//w:tbl', $namespaceManager).Item(1)
    $rows = @($registerTable.SelectNodes('./w:tr', $namespaceManager))

    if ($rows.Count -ne 265) {
        throw "Expected 265 rows in the generated register table; found $($rows.Count)."
    }

    for ($itemIndex = 0; $itemIndex -lt 88; $itemIndex++) {
        $startRowIndex = 1 + ($itemIndex * 3)
        foreach ($columnIndex in @(0, 1)) {
            for ($offset = 0; $offset -lt 3; $offset++) {
                $cell = @($rows[$startRowIndex + $offset].SelectNodes('./w:tc', $namespaceManager))[$columnIndex]
                $cellProperties = $cell.SelectSingleNode('./w:tcPr', $namespaceManager)
                if ($null -eq $cellProperties) {
                    $cellProperties = $xml.CreateElement('w', 'tcPr', $wordNamespace)
                    [void]$cell.PrependChild($cellProperties)
                }
                $verticalMerge = $xml.CreateElement('w', 'vMerge', $wordNamespace)
                if ($offset -eq 0) {
                    $verticalMerge.SetAttribute('val', $wordNamespace, 'restart')
                }
                [void]$cellProperties.AppendChild($verticalMerge)
            }
        }
    }

    $entry.Delete()
    $newEntry = $archive.CreateEntry('word/document.xml', [System.IO.Compression.CompressionLevel]::Optimal)
    $writer = New-Object System.IO.StreamWriter($newEntry.Open(), (New-Object System.Text.UTF8Encoding($false)))
    try { $xml.Save($writer) } finally { $writer.Dispose() }
}
finally {
    $archive.Dispose()
}

Write-Host "Created $outputPath"
Write-Host "Created $ledgerPath"