$ErrorActionPreference = 'Stop'

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$documentPath = Join-Path $base 'part-d-extracted\word\document.xml'
$outputPath = Join-Path $base 'comment-wording.json'

$document = New-Object System.Xml.XmlDocument
$document.PreserveWhitespace = $true
$document.Load($documentPath)

$wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$namespaceManager = New-Object System.Xml.XmlNamespaceManager($document.NameTable)
$namespaceManager.AddNamespace('w', $wordNamespace)

function Clean-Text([string]$text) {
    return ($text -replace "[\r\a]", ' ' -replace "\s+", ' ').Trim()
}

function Has-Ancestor($node, [string]$localName) {
    $current = $node.ParentNode
    while ($null -ne $current) {
        if ($current.NamespaceURI -eq $wordNamespace -and $current.LocalName -eq $localName) {
            return $true
        }
        $current = $current.ParentNode
    }
    return $false
}

function Append-NodeText($node, [System.Text.StringBuilder]$builder) {
    if ($node.NamespaceURI -ne $wordNamespace) { return }
    switch ($node.LocalName) {
        't' { [void]$builder.Append($node.InnerText) }
        'delText' { [void]$builder.Append($node.InnerText) }
        'tab' { [void]$builder.Append("`t") }
        'br' { [void]$builder.Append("`n") }
        'cr' { [void]$builder.Append("`n") }
    }
}

$starts = @{}
foreach ($start in $document.SelectNodes('//w:commentRangeStart', $namespaceManager)) {
    $id = $start.GetAttribute('id', $wordNamespace)
    $starts[$id] = $start
}

$orderedNodes = @($document.SelectNodes('//*'))
$nodePositions = @{}
for ($nodeIndex = 0; $nodeIndex -lt $orderedNodes.Count; $nodeIndex++) {
    $nodePositions[$orderedNodes[$nodeIndex]] = $nodeIndex
}

$records = @()
foreach ($id in ($starts.Keys | Sort-Object { [int]$_ })) {
    $start = $starts[$id]
    $end = $document.SelectSingleNode("//w:commentRangeEnd[@w:id='$id']", $namespaceManager)
    if ($null -eq $end) { continue }

    $allBuilder = New-Object System.Text.StringBuilder
    $currentBuilder = New-Object System.Text.StringBuilder
    $proposedBuilder = New-Object System.Text.StringBuilder
    $startPosition = [int]$nodePositions[$start]
    $endPosition = [int]$nodePositions[$end]

    for ($nodeIndex = $startPosition + 1; $nodeIndex -lt $endPosition; $nodeIndex++) {
        $cursor = $orderedNodes[$nodeIndex]
        if ($cursor.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
        if ($cursor.LocalName -notin @('t', 'delText', 'tab', 'br', 'cr')) { continue }

        $insideInsertion = Has-Ancestor $cursor 'ins'
        $insideDeletion = Has-Ancestor $cursor 'del'
        Append-NodeText $cursor $allBuilder
        if (-not $insideInsertion) { Append-NodeText $cursor $currentBuilder }
        if (-not $insideDeletion) { Append-NodeText $cursor $proposedBuilder }
    }

    $records += [ordered]@{
        commentId = [int]$id
        allText = Clean-Text $allBuilder.ToString()
        currentText = Clean-Text $currentBuilder.ToString()
        proposedText = Clean-Text $proposedBuilder.ToString()
    }
}

$records | ConvertTo-Json -Depth 5 | Set-Content $outputPath -Encoding UTF8
Write-Host "Created $outputPath with $($records.Count) comment wording records"