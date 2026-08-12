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

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'build'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.Clear([System.Drawing.Color]::Transparent)

$graphite = [System.Drawing.ColorTranslator]::FromHtml('#2F3437')
$paper = [System.Drawing.ColorTranslator]::FromHtml('#FFFDF8')
$paperLine = [System.Drawing.ColorTranslator]::FromHtml('#D9D9D7')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#37352F')
$outerPath = New-RoundedPath 20 20 216 216 42
$backPagePath = New-RoundedPath 82 58 105 133 12
$frontPagePath = New-RoundedPath 64 43 111 143 12
$graphics.FillPath((New-Object System.Drawing.SolidBrush $graphite), $outerPath)
$graphics.FillPath((New-Object System.Drawing.SolidBrush $paperLine), $backPagePath)
$graphics.FillPath((New-Object System.Drawing.SolidBrush $paper), $frontPagePath)

$linePen = New-Object System.Drawing.Pen $ink, 9
$linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($linePen, 90, 85, 149, 85)
$graphics.DrawLine($linePen, 90, 113, 145, 113)
$graphics.DrawLine($linePen, 90, 141, 128, 141)

$pngPath = Join-Path $outputDirectory 'icon.png'
$icoPath = Join-Path $outputDirectory 'icon.ico'
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $stream.ToArray()
$writer = New-Object System.IO.BinaryWriter([System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create))
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Close()
$stream.Dispose()
$linePen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
