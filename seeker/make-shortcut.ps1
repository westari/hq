# Puts a "Seeker" app icon on your Desktop and in the Start menu.
$hq = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $hq "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $exe)) { Write-Host "Run 'npm install' in the hq folder first."; exit 1 }
$sh = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
foreach ($p in $places) {
  $s = $sh.CreateShortcut((Join-Path $p 'Seeker.lnk'))
  $s.TargetPath = $exe
  $s.Arguments = '"' + $PSScriptRoot + '"'
  $s.WorkingDirectory = $PSScriptRoot
  $s.IconLocation = (Join-Path $PSScriptRoot 'icon.ico')
  $s.Description = 'Seeker'
  $s.Save()
}
Write-Host "Done. Seeker is on your Desktop and in the Start menu."
