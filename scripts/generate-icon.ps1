Add-Type -AssemblyName System.Drawing

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-InkspaceIcon([int]$size) {
  $scale = $size / 256
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.ScaleTransform($scale, $scale)

  $black = [System.Drawing.ColorTranslator]::FromHtml('#090909')
  $backPage = [System.Drawing.ColorTranslator]::FromHtml('#2B2B2B')
  $paper = [System.Drawing.ColorTranslator]::FromHtml('#F5F5F2')
  $fold = [System.Drawing.ColorTranslator]::FromHtml('#D9D9D4')
  $ink = [System.Drawing.ColorTranslator]::FromHtml('#111111')
  $accent = [System.Drawing.ColorTranslator]::FromHtml('#529CCA')

  $outerPath = New-RoundedPath 16 16 224 224 52
  $backPagePath = New-RoundedPath 86 54 100 137 15
  $frontPagePath = New-RoundedPath 59 39 109 145 15
  $graphics.FillPath((New-Object System.Drawing.SolidBrush $black), $outerPath)
  $graphics.FillPath((New-Object System.Drawing.SolidBrush $backPage), $backPagePath)
  $graphics.FillPath((New-Object System.Drawing.SolidBrush $paper), $frontPagePath)

  $foldPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $foldPath.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF 137, 39),
    (New-Object System.Drawing.PointF 168, 70),
    (New-Object System.Drawing.PointF 151, 70),
    (New-Object System.Drawing.PointF 137, 56)
  ))
  $graphics.FillPath((New-Object System.Drawing.SolidBrush $fold), $foldPath)

  $promptPen = New-Object System.Drawing.Pen $accent, 9
  $promptPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $promptPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLines($promptPen, [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF 88, 93),
    (New-Object System.Drawing.PointF 106, 111),
    (New-Object System.Drawing.PointF 88, 129)
  ))

  $cursorPen = New-Object System.Drawing.Pen $ink, 9
  $cursorPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cursorPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($cursorPen, 119, 129, 144, 129)

  $cursorPen.Dispose()
  $promptPen.Dispose()
  $foldPath.Dispose()
  $frontPagePath.Dispose()
  $backPagePath.Dispose()
  $outerPath.Dispose()
  $graphics.Dispose()
  return $bitmap
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'build'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$pngPath = Join-Path $outputDirectory 'icon.png'
$icoPath = Join-Path $outputDirectory 'icon.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = @()

foreach ($size in $sizes) {
  $bitmap = New-InkspaceIcon $size
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += ,$stream.ToArray()
  if ($size -eq 256) {
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $stream.Dispose()
  $bitmap.Dispose()
}

$writer = New-Object System.IO.BinaryWriter([System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create))
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)
$offset = 6 + (16 * $sizes.Count)

for ($index = 0; $index -lt $sizes.Count; $index += 1) {
  $dimension = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
  $writer.Write([Byte]$dimension)
  $writer.Write([Byte]$dimension)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngs[$index].Length)
  $writer.Write([UInt32]$offset)
  $offset += $pngs[$index].Length
}

foreach ($png in $pngs) {
  $writer.Write($png)
}

$writer.Close()
