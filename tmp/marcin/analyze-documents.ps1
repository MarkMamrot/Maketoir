$ErrorActionPreference = 'Stop'

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$partCPath = Join-Path $base '850DCP0036 - Part C, Item 16 (Commercial Clarification Register) 1.docx'
$partDPath = Join-Path $base '850DCP0036- Part D - Draft Contract (Draft)_RFT 14.08.2026_EMOB Redlines.docx'

function Clean-WordText([string]$text) {
    if ($null -eq $text) { return '' }
    return ($text -replace "[\r\a]", ' ' -replace "\s+", ' ').Trim()
}

function Get-StyleName($range) {
    try { return [string]$range.Style.NameLocal } catch { return [string]$range.Style }
}

function Get-ParagraphRecord($paragraph, [int]$index) {
    $range = $paragraph.Range
    $listString = ''
    try { $listString = [string]$range.ListFormat.ListString } catch {}
    $outlineLevel = $null
    try { $outlineLevel = [int]$paragraph.OutlineLevel } catch {}
    [ordered]@{
        index = $index
        start = [int]$range.Start
        end = [int]$range.End
        text = Clean-WordText $range.Text
        style = Get-StyleName $range
        list = $listString
        outlineLevel = $outlineLevel
        inTable = [bool]$range.Information(12)
    }
}

function Get-NearestContext($paragraphs, [int]$position) {
    $current = $null
    $heading = $null
    $part = $null
    foreach ($paragraph in $paragraphs) {
        if ($paragraph.start -gt $position) { break }
        if ($paragraph.text) {
            $current = $paragraph
            if ($paragraph.style -match 'Heading|Title' -or ($paragraph.outlineLevel -ge 1 -and $paragraph.outlineLevel -le 9)) {
                $heading = $paragraph
            }
            if ($paragraph.text -match '^(Annexure|Schedule|Appendix)\b' -or $paragraph.style -match 'Annexure|Schedule|Appendix') {
                $part = $paragraph
            }
        }
    }
    [ordered]@{
        paragraph = $current
        heading = $heading
        contractPart = $part
    }
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $partC = $word.Documents.Open($partCPath, $false, $true, $false)
    try {
        $tables = @()
        for ($tableIndex = 1; $tableIndex -le $partC.Tables.Count; $tableIndex++) {
            $table = $partC.Tables.Item($tableIndex)
            $cells = @()
            foreach ($cell in $table.Range.Cells) {
                $cells += [ordered]@{
                    row = [int]$cell.RowIndex
                    column = [int]$cell.ColumnIndex
                    text = Clean-WordText $cell.Range.Text
                    width = [math]::Round([double]$cell.Width, 2)
                    verticalAlignment = [int]$cell.VerticalAlignment
                }
            }
            $tables += [ordered]@{
                index = $tableIndex
                rows = [int]$table.Rows.Count
                columns = [int]$table.Columns.Count
                cells = $cells
            }
        }

        $paragraphs = @()
        for ($index = 1; $index -le $partC.Paragraphs.Count; $index++) {
            $record = Get-ParagraphRecord $partC.Paragraphs.Item($index) $index
            if ($record.text) { $paragraphs += $record }
        }

        $sections = @()
        for ($index = 1; $index -le $partC.Sections.Count; $index++) {
            $section = $partC.Sections.Item($index)
            $sections += [ordered]@{
                index = $index
                orientation = [int]$section.PageSetup.Orientation
                pageWidth = [math]::Round([double]$section.PageSetup.PageWidth, 2)
                pageHeight = [math]::Round([double]$section.PageSetup.PageHeight, 2)
                margins = [ordered]@{
                    top = [math]::Round([double]$section.PageSetup.TopMargin, 2)
                    bottom = [math]::Round([double]$section.PageSetup.BottomMargin, 2)
                    left = [math]::Round([double]$section.PageSetup.LeftMargin, 2)
                    right = [math]::Round([double]$section.PageSetup.RightMargin, 2)
                }
            }
        }

        $partCResult = [ordered]@{
            paragraphs = $paragraphs
            tableCount = [int]$partC.Tables.Count
            tables = $tables
            sections = $sections
            revisions = [int]$partC.Revisions.Count
            comments = [int]$partC.Comments.Count
            contentControls = [int]$partC.ContentControls.Count
            shapes = [int]$partC.Shapes.Count
            inlineShapes = [int]$partC.InlineShapes.Count
        }
        $partCResult | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $base 'part-c-analysis.json') -Encoding UTF8
    }
    finally {
        $partC.Close($false)
    }

    $partD = $word.Documents.Open($partDPath, $false, $true, $false)
    try {
        $paragraphs = @()
        for ($index = 1; $index -le $partD.Paragraphs.Count; $index++) {
            $paragraphs += Get-ParagraphRecord $partD.Paragraphs.Item($index) $index
        }

        $revisions = @()
        for ($index = 1; $index -le $partD.Revisions.Count; $index++) {
            $revision = $partD.Revisions.Item($index)
            $range = $revision.Range
            $contextStart = [math]::Max(0, [int]$range.Start - 180)
            $contextEnd = [math]::Min([int]$partD.Content.End, [int]$range.End + 180)
            $contextRange = $partD.Range($contextStart, $contextEnd)
            $revisions += [ordered]@{
                index = $index
                type = [int]$revision.Type
                author = [string]$revision.Author
                date = $revision.Date.ToString('o')
                start = [int]$range.Start
                end = [int]$range.End
                text = Clean-WordText $range.Text
                contextText = Clean-WordText $contextRange.Text
                context = Get-NearestContext $paragraphs ([int]$range.Start)
            }
        }

        $comments = @()
        for ($index = 1; $index -le $partD.Comments.Count; $index++) {
            $comment = $partD.Comments.Item($index)
            $scope = $comment.Scope
            $comments += [ordered]@{
                index = $index
                author = [string]$comment.Author
                initials = [string]$comment.Initial
                date = $comment.Date.ToString('o')
                text = Clean-WordText $comment.Range.Text
                scopeStart = [int]$scope.Start
                scopeEnd = [int]$scope.End
                scopeText = Clean-WordText $scope.Text
                context = Get-NearestContext $paragraphs ([int]$scope.Start)
            }
        }

        $legalHierarchy = @($paragraphs | Where-Object {
            $_.text -and (
                $_.style -match 'Heading|Title|Annexure|Schedule|Appendix' -or
                ($_.outlineLevel -ge 1 -and $_.outlineLevel -le 9) -or
                $_.text -match '^(Annexure|Schedule|Appendix|Part\s+[A-Z0-9]+)\b'
            )
        })

        $partDResult = [ordered]@{
            paragraphCount = [int]$partD.Paragraphs.Count
            tableCount = [int]$partD.Tables.Count
            sectionCount = [int]$partD.Sections.Count
            revisionCount = [int]$partD.Revisions.Count
            commentCount = [int]$partD.Comments.Count
            contentControls = [int]$partD.ContentControls.Count
            shapes = [int]$partD.Shapes.Count
            inlineShapes = [int]$partD.InlineShapes.Count
            legalHierarchy = $legalHierarchy
            revisions = $revisions
            comments = $comments
        }
        $partDResult | ConvertTo-Json -Depth 15 | Set-Content (Join-Path $base 'part-d-analysis.json') -Encoding UTF8
    }
    finally {
        $partD.Close($false)
    }
}
finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}

Write-Host 'Created part-c-analysis.json and part-d-analysis.json'