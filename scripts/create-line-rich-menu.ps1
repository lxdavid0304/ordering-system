Add-Type -AssemblyName System.Drawing

$outputPath = Join-Path $PSScriptRoot "..\assets\line-rich-menu\default-rich-menu.png"
$width = 2500
$height = 1686
$topHeight = $height / 2
$bottomCellWidth = $width / 3

function New-Color([string]$hex) {
  [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function New-Text([int[]]$codes) {
  -join ($codes | ForEach-Object { [char]$_ })
}

function Draw-CenteredText($graphics, [string]$text, $font, $brush, [single]$centerX, [single]$centerY) {
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString($text, $font, $brush, $centerX, $centerY, $format)
  $format.Dispose()
}

function Draw-CartIcon($graphics, $pen, $brush, [single]$centerX, [single]$centerY) {
  $graphics.DrawLine($pen, $centerX - 245, $centerY - 95, $centerX - 185, $centerY - 95)
  $graphics.DrawLine($pen, $centerX - 190, $centerY - 95, $centerX - 130, $centerY + 95)
  $points = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($centerX - 130, $centerY - 45),
    [System.Drawing.PointF]::new($centerX + 200, $centerY - 45),
    [System.Drawing.PointF]::new($centerX + 145, $centerY + 105),
    [System.Drawing.PointF]::new($centerX - 80, $centerY + 105)
  )
  $graphics.DrawPolygon($pen, $points)
  $graphics.DrawLine($pen, $centerX - 55, $centerY + 35, $centerX + 165, $centerY + 35)
  $graphics.FillEllipse($brush, $centerX - 65, $centerY + 145, 52, 52)
  $graphics.FillEllipse($brush, $centerX + 120, $centerY + 145, 52, 52)
}

function Draw-ProductIcon($graphics, $pen, [single]$centerX, [single]$centerY) {
  $graphics.DrawRectangle($pen, $centerX - 155, $centerY - 90, 310, 215)
  $graphics.DrawLine($pen, $centerX - 155, $centerY - 25, $centerX + 155, $centerY - 25)
  $graphics.DrawLine($pen, $centerX, $centerY - 90, $centerX, $centerY + 125)
  $graphics.DrawLine($pen, $centerX - 185, $centerY - 90, $centerX + 185, $centerY - 90)
  $graphics.DrawLine($pen, $centerX - 125, $centerY - 140, $centerX + 125, $centerY - 140)
  $graphics.DrawLine($pen, $centerX - 125, $centerY - 140, $centerX - 155, $centerY - 90)
  $graphics.DrawLine($pen, $centerX + 125, $centerY - 140, $centerX + 155, $centerY - 90)
}

$bitmap = [System.Drawing.Bitmap]::new($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$red = New-Color "#D92736"
$blue = New-Color "#1E5D8F"
$mint = New-Color "#E8F4EE"
$gray = New-Color "#E7EDF1"
$white = [System.Drawing.Color]::White
$ink = New-Color "#15384D"
$muted = New-Color "#73808A"
$divider = New-Color "#FFFFFF"

$graphics.Clear($white)
$graphics.FillRectangle([System.Drawing.SolidBrush]::new($blue), 0, 0, $width, $topHeight)
$graphics.FillRectangle([System.Drawing.SolidBrush]::new($mint), 0, $topHeight, $bottomCellWidth, $topHeight)
$graphics.FillRectangle([System.Drawing.SolidBrush]::new($red), $bottomCellWidth, $topHeight, $bottomCellWidth, $topHeight)
$graphics.FillRectangle([System.Drawing.SolidBrush]::new($gray), $bottomCellWidth * 2, $topHeight, $bottomCellWidth, $topHeight)

$dividerPen = [System.Drawing.Pen]::new($divider, 10)
$graphics.DrawLine($dividerPen, 0, $topHeight, $width, $topHeight)
$graphics.DrawLine($dividerPen, $bottomCellWidth, $topHeight, $bottomCellWidth, $height)
$graphics.DrawLine($dividerPen, $bottomCellWidth * 2, $topHeight, $bottomCellWidth * 2, $height)

$titleFont = [System.Drawing.Font]::new("Microsoft JhengHei UI", 70, [System.Drawing.FontStyle]::Bold)
$smallFont = [System.Drawing.Font]::new("Microsoft JhengHei UI", 34, [System.Drawing.FontStyle]::Regular)
$symbolFont = [System.Drawing.Font]::new("Segoe UI", 144, [System.Drawing.FontStyle]::Bold)

$whiteBrush = [System.Drawing.SolidBrush]::new($white)
$inkBrush = [System.Drawing.SolidBrush]::new($ink)
$mutedBrush = [System.Drawing.SolidBrush]::new($muted)
$whitePen = [System.Drawing.Pen]::new($white, 28)

Draw-CartIcon $graphics $whitePen $whiteBrush 1250 285
Draw-CenteredText $graphics (New-Text @(0x6211, 0x8981, 0x8A02, 0x8CFC)) $titleFont $whiteBrush 1250 590
Draw-CenteredText $graphics (New-Text @(0x7ACB, 0x5373, 0x958B, 0x59CB, 0x586B, 0x55AE)) $smallFont $whiteBrush 1250 695

Draw-CenteredText $graphics "i" $symbolFont $inkBrush 416 1120
Draw-CenteredText $graphics (New-Text @(0x53D6, 0x8CA8, 0x8207, 0x4ED8, 0x6B3E)) $titleFont $inkBrush 416 1400
Draw-CenteredText $graphics (New-Text @(0x6D41, 0x7A0B, 0x8207, 0x6CE8, 0x610F, 0x4E8B, 0x9805)) $smallFont $inkBrush 416 1510

Draw-ProductIcon $graphics $whitePen 1250 1115
Draw-CenteredText $graphics (New-Text @(0x71B1, 0x9580, 0x5546, 0x54C1)) $titleFont $whiteBrush 1250 1400
Draw-CenteredText $graphics (New-Text @(0x958B, 0x5718, 0x4E2D, 0x5546, 0x54C1)) $smallFont $whiteBrush 1250 1510

Draw-CenteredText $graphics "?" $symbolFont $mutedBrush 2083 1120
Draw-CenteredText $graphics (New-Text @(0x656C, 0x8ACB, 0x671F, 0x5F85)) $titleFont $mutedBrush 2083 1400
Draw-CenteredText $graphics (New-Text @(0x66F4, 0x591A, 0x670D, 0x52D9, 0x6E96, 0x5099, 0x4E2D)) $smallFont $mutedBrush 2083 1510

$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$dividerPen.Dispose()
$whiteBrush.Dispose()
$inkBrush.Dispose()
$mutedBrush.Dispose()
$whitePen.Dispose()
$titleFont.Dispose()
$smallFont.Dispose()
$symbolFont.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Created $outputPath"
