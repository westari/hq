# Puts an "HQ" app icon on your Desktop and in the Start menu.
$exe = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $exe)) { Write-Host "Run 'npm install' in this folder first."; exit 1 }
$sh = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
foreach ($p in $places) {
  $s = $sh.CreateShortcut((Join-Path $p 'HQ.lnk'))
  $s.TargetPath = $exe
  $s.Arguments = '"' + $PSScriptRoot + '"'
  $s.WorkingDirectory = $PSScriptRoot
  $s.IconLocation = (Join-Path $PSScriptRoot 'icon.ico')
  $s.Description = 'HQ'
  $s.Save()
}
Write-Host "Done. HQ is on your Desktop and in the Start menu."
