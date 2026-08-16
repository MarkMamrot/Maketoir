$ErrorActionPreference = 'Stop'

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$templatePath = Join-Path $base '850DCP0036 - Part C, Item 16 (Commercial Clarification Register) 1.docx'
$outputPath = Join-Path $base '850DCP0036 - Part C Item 16 - IMPLEMENTED OPTION 1 FINAL.docx'
$ledgerPath = Join-Path $base 'OPTION-1-REGISTER-LEDGER.json'
$ledgerData = Get-Content $ledgerPath -Raw | ConvertFrom-Json
$ledger = @($ledgerData.PSObject.BaseObject)

if ($ledger.Count -ne 88) { throw "Expected 88 ledger entries; found $($ledger.Count)." }

Copy-Item $templatePath $outputPath -Force
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function Set-CellText($xml, $namespaceManager, $cell, [string]$text, [bool]$red) {
    $templateParagraph = $cell.SelectSingleNode('./w:p', $namespaceManager)
    $templateParagraphProperties = $templateParagraph.SelectSingleNode('./w:pPr', $namespaceManager)
    $templateRunProperties = $templateParagraph.SelectSingleNode('.//w:rPr', $namespaceManager)

    foreach ($paragraph in @($cell.SelectNodes('./w:p', $namespaceManager))) {
        [void]$cell.RemoveChild($paragraph)
    }

    $lines = @($text -split "`r?`n")
    if ($lines.Count -eq 0) { $lines = @('') }
    foreach ($line in $lines) {
        $paragraph = $xml.CreateElement('w', 'p', $wordNamespace)
        if ($null -ne $templateParagraphProperties) {
            [void]$paragraph.AppendChild($templateParagraphProperties.CloneNode($true))
        }
        $run = $xml.CreateElement('w', 'r', $wordNamespace)
        $runProperties = $xml.CreateElement('w', 'rPr', $wordNamespace)
        $color = $xml.CreateElement('w', 'color', $wordNamespace)
        [void]$color.SetAttribute('val', $wordNamespace, $(if ($red) { 'FF0000' } else { '000000' }))
        [void]$runProperties.AppendChild($color)
        [void]$run.AppendChild($runProperties)
        $textNode = $xml.CreateElement('w', 't', $wordNamespace)
        $spaceAttribute = $xml.CreateAttribute('xml', 'space', 'http://www.w3.org/XML/1998/namespace')
        $spaceAttribute.Value = 'preserve'
        [void]$textNode.Attributes.Append($spaceAttribute)
        $textNode.InnerText = $line
        [void]$run.AppendChild($textNode)
        [void]$paragraph.AppendChild($run)
        [void]$cell.AppendChild($paragraph)
    }
}

$archive = [System.IO.Compression.ZipFile]::Open($outputPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $documentEntry = $archive.GetEntry('word/document.xml')
    $reader = New-Object System.IO.StreamReader($documentEntry.Open())
    try { $xmlText = $reader.ReadToEnd() } finally { $reader.Dispose() }

    $xml = New-Object System.Xml.XmlDocument
    $xml.PreserveWhitespace = $true
    $xml.LoadXml($xmlText)
    $namespaceManager = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $namespaceManager.AddNamespace('w', $wordNamespace)

    $tables = @($xml.SelectNodes('//w:body/w:tbl', $namespaceManager))
    if ($tables.Count -ne 6) { throw "Expected 6 template tables; found $($tables.Count)." }

    $revisionRows = @($tables[0].SelectNodes('./w:tr', $namespaceManager))
    $revisionACells = @($revisionRows[1].SelectNodes('./w:tc', $namespaceManager))
    Set-CellText $xml $namespaceManager $revisionACells[1] '14 Aug 2026' $false
    Set-CellText $xml $namespaceManager $revisionACells[2] 'Tenderer initial submission - proposed revisions and commercial clarifications to Part D Draft Contract.' $false

    $registerTable = $tables[1]
    $registerRows = @($registerTable.SelectNodes('./w:tr', $namespaceManager))
    $templateRows = @($registerRows[1].CloneNode($true), $registerRows[2].CloneNode($true), $registerRows[3].CloneNode($true))

    foreach ($row in @($registerRows | Select-Object -Skip 1)) {
        [void]$registerTable.RemoveChild($row)
    }

    foreach ($entry in $ledger) {
        $rows = @($templateRows | ForEach-Object { $_.CloneNode($true) })
        $firstCells = @($rows[0].SelectNodes('./w:tc', $namespaceManager))
        $secondCells = @($rows[1].SelectNodes('./w:tc', $namespaceManager))
        $thirdCells = @($rows[2].SelectNodes('./w:tc', $namespaceManager))
        $red = [bool]$entry.internalAction

        Set-CellText $xml $namespaceManager $firstCells[0] ([string]$entry.itemNumber) $red
        Set-CellText $xml $namespaceManager $firstCells[1] ([string]$entry.sectionClause) $red
        Set-CellText $xml $namespaceManager $firstCells[2] ([string]$entry.date) $red
        Set-CellText $xml $namespaceManager $firstCells[3] 'Tenderer' $red
        Set-CellText $xml $namespaceManager $firstCells[4] ([string]$entry.clarification) $red
        Set-CellText $xml $namespaceManager $firstCells[5] ([string]$entry.status) $red

        Set-CellText $xml $namespaceManager $secondCells[0] '' $red
        Set-CellText $xml $namespaceManager $secondCells[1] '' $red
        Set-CellText $xml $namespaceManager $secondCells[2] '' $red
        Set-CellText $xml $namespaceManager $secondCells[3] 'Fortescue' $red
        Set-CellText $xml $namespaceManager $secondCells[4] '' $red
        Set-CellText $xml $namespaceManager $secondCells[5] '' $red

        Set-CellText $xml $namespaceManager $thirdCells[0] '' $red
        Set-CellText $xml $namespaceManager $thirdCells[1] '' $red
        Set-CellText $xml $namespaceManager $thirdCells[2] '' $red
        Set-CellText $xml $namespaceManager $thirdCells[3] 'Tenderer' $red
        Set-CellText $xml $namespaceManager $thirdCells[4] '' $red
        Set-CellText $xml $namespaceManager $thirdCells[5] '' $red

        foreach ($row in $rows) { [void]$registerTable.AppendChild($row) }
    }

    foreach ($continuationTable in @($tables[2], $tables[3], $tables[4])) {
        [void]$continuationTable.ParentNode.RemoveChild($continuationTable)
    }

    $documentEntry.Delete()
    $newEntry = $archive.CreateEntry('word/document.xml', [System.IO.Compression.CompressionLevel]::Optimal)
    $writer = New-Object System.IO.StreamWriter($newEntry.Open(), (New-Object System.Text.UTF8Encoding($false)))
    try { $xml.Save($writer) } finally { $writer.Dispose() }
}
finally {
    $archive.Dispose()
}

Write-Host "Created $outputPath"