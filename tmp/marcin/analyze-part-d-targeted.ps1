$ErrorActionPreference = 'Stop'

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$documentPath = Join-Path $base '850DCP0036- Part D - Draft Contract (Draft)_RFT 14.08.2026_EMOB Redlines.docx'
$outputPath = Join-Path $base 'part-d-targeted-analysis.json'

function Clean-Text([string]$text) {
    if ($null -eq $text) { return '' }
    return ($text -replace "[\r\a]", ' ' -replace "\s+", ' ').Trim()
}

function Get-Style($range) {
    try { return [string]$range.Style.NameLocal } catch { return [string]$range.Style }
}

function Get-ListString($range) {
    try { return [string]$range.ListFormat.ListString } catch { return '' }
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $document = $word.Documents.Open($documentPath, $false, $true, $false)
    try {
        $tocEntries = @()
        for ($tocIndex = 1; $tocIndex -le $document.TablesOfContents.Count; $tocIndex++) {
            $toc = $document.TablesOfContents.Item($tocIndex)
            foreach ($paragraph in $toc.Range.Paragraphs) {
                $text = Clean-Text $paragraph.Range.Text
                if ($text) {
                    $tocEntries += [ordered]@{
                        toc = $tocIndex
                        text = $text
                        style = Get-Style $paragraph.Range
                        page = [int]$paragraph.Range.Information(3)
                    }
                }
            }
        }

        $comments = @()
        for ($commentIndex = 1; $commentIndex -le $document.Comments.Count; $commentIndex++) {
            $comment = $document.Comments.Item($commentIndex)
            $scope = $comment.Scope
            $paragraph = $scope.Paragraphs.Item(1).Range
            $contextStart = [math]::Max(0, [int]$paragraph.Start - 2500)
            $contextEnd = [math]::Min([int]$document.Content.End, [int]$paragraph.End + 1500)
            $contextRange = $document.Range($contextStart, $contextEnd)

            $preceding = @()
            foreach ($contextParagraph in $contextRange.Paragraphs) {
                if ($contextParagraph.Range.Start -ge $paragraph.Start) { break }
                $contextText = Clean-Text $contextParagraph.Range.Text
                if ($contextText) {
                    $preceding += [ordered]@{
                        text = $contextText
                        list = Get-ListString $contextParagraph.Range
                        style = Get-Style $contextParagraph.Range
                    }
                }
            }
            if ($preceding.Count -gt 12) {
                $preceding = @($preceding | Select-Object -Last 12)
            }

            $table = $null
            if ($scope.Information(12)) {
                $cell = $scope.Cells.Item(1)
                $table = [ordered]@{
                    tableIndex = [int]$cell.Range.Tables.Item(1).Index
                    row = [int]$cell.RowIndex
                    column = [int]$cell.ColumnIndex
                }
            }

            $comments += [ordered]@{
                index = $commentIndex
                author = [string]$comment.Author
                date = $comment.Date.ToString('o')
                commentText = Clean-Text $comment.Range.Text
                page = [int]$scope.Information(3)
                scopeStart = [int]$scope.Start
                scopeEnd = [int]$scope.End
                scopeText = Clean-Text $scope.Text
                paragraphText = Clean-Text $paragraph.Text
                paragraphList = Get-ListString $paragraph
                paragraphStyle = Get-Style $paragraph
                table = $table
                precedingParagraphs = $preceding
            }
        }

        $result = [ordered]@{
            pages = [int]$document.ComputeStatistics(2)
            tables = [int]$document.Tables.Count
            sections = [int]$document.Sections.Count
            revisions = [int]$document.Revisions.Count
            comments = [int]$document.Comments.Count
            tocEntries = $tocEntries
            commentAnchors = $comments
        }
        $result | ConvertTo-Json -Depth 12 | Set-Content $outputPath -Encoding UTF8
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