$ErrorActionPreference = 'Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"
Import-Module "$PSHOME/Modules/PKI/PKI.psd1"
Import-Module "$PSHOME/Modules/Appx/Appx.psd1"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assets = Join-Path $projectRoot 'src-tauri/windows-context-menu/generated'
$manager = Join-Path $projectRoot 'src-tauri/windows-context-menu/manage.ps1'
$testRoot = Join-Path $projectRoot ('.cache/menu-management-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($testRoot)
$executable = Join-Path $testRoot 'vrykell.exe'
[IO.File]::WriteAllBytes($executable, [byte[]]@())
$certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2((Join-Path $assets 'Vrykell.ContextMenu.cer'))
$global:MenuManagementTestState = @{ registered = $false; exe = $null; bundle = $null; additions = 0; removals = 0; failNext = $false }
$global:MenuManagementTestThumbprint = $certificate.Thumbprint

# Replace deployment and registry effects in this test process only; no trust or UAC changes occur.
function Get-AppxPackage { param($Name)
 if ($global:MenuManagementTestState.registered) { [pscustomobject]@{ Publisher = 'CN=Vrykell'; PackageFullName = 'test-package' } }
}
function Remove-AppxPackage { param($Package) $global:MenuManagementTestState.registered = $false; $global:MenuManagementTestState.removals++ }
function Add-AppxPackage { param($Path, $ExternalLocation)
 $global:MenuManagementTestState.additions++
 if ($global:MenuManagementTestState.failNext) { $global:MenuManagementTestState.failNext = $false; throw 'Simulated deployment failure' }
 $global:MenuManagementTestState.registered = $true
}
function Get-ItemProperty { [CmdletBinding()]param($LiteralPath, $Name)
 if ($LiteralPath -eq 'HKCU:/Software/Vrykell/ContextMenu') {
  return [pscustomobject]@{ Executable = $global:MenuManagementTestState.exe; Bundle = $global:MenuManagementTestState.bundle }
 }
 throw 'Unexpected registry read in management test.'
}
function New-Item { param($Path, [switch]$Force)
 if ($Path -ne 'HKCU:/Software/Vrykell/ContextMenu') { throw 'Unexpected registry key in management test.' }
}
function New-ItemProperty { param($LiteralPath, $Name, $Value, $PropertyType, [switch]$Force)
 if ($LiteralPath -ne 'HKCU:/Software/Vrykell/ContextMenu') { throw 'Unexpected registry write in management test.' }
 if ($Name -eq 'Executable') { $global:MenuManagementTestState.exe = $Value }
 elseif ($Name -eq 'Bundle') { $global:MenuManagementTestState.bundle = $Value }
 else { throw 'Unexpected registry value in management test.' }
}
function Remove-ItemProperty { [CmdletBinding()]param($LiteralPath, $Name)
 if ($LiteralPath -ne 'HKCU:/Software/Vrykell/ContextMenu') { throw 'Unexpected registry removal in management test.' }
 $global:MenuManagementTestState.exe = $null; $global:MenuManagementTestState.bundle = $null
}
function Test-Path { [CmdletBinding()]param($LiteralPath, $Path, $PathType)
 $target = if ($LiteralPath) { $LiteralPath } else { $Path }
 if ($target -eq "Cert:/LocalMachine/TrustedPeople/$global:MenuManagementTestThumbprint") { return $true }
 if ($target -eq 'HKCU:/Software/Vrykell/ContextMenu') { return $true }
 $arguments = @{ LiteralPath = $target }
 if ($PathType) { $arguments.PathType = $PathType }
 return Microsoft.PowerShell.Management\Test-Path @arguments
}
function Assert([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }

$snapshot = $null
$snapshotExisted = $false
try {
 $stream = [IO.File]::OpenRead((Join-Path $assets 'Vrykell.ContextMenu.msix'))
 $hash = [Security.Cryptography.SHA256]::Create()
 try { $digest = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
 finally { $stream.Dispose(); $hash.Dispose() }
 $snapshot = Join-Path $env:LOCALAPPDATA "com.vrykell.app/context-menu/packages/$digest.msix"
 $snapshotExisted = Test-Path -LiteralPath $snapshot
 # Match the extended-length paths supplied by the installed native application.
 $extendedAssets = '\\?\' + $assets
 $extendedExecutable = '\\?\' + $executable
 $result = (& $manager -Action status -AssetDirectory $extendedAssets -Executable $extendedExecutable) | ConvertFrom-Json
 Assert $result.available 'Extended-length resource paths were not accepted.'
 $result = (& $manager -Action enable -AssetDirectory $extendedAssets -Executable $extendedExecutable) | ConvertFrom-Json
 Assert $result.enabled 'The menu did not report a successful registration.'
 Assert ($global:MenuManagementTestState.exe -eq $executable) 'The stored launch path retained its extended-length prefix.'
 $beforeBundle = $global:MenuManagementTestState.bundle
 $beforeAdds = $global:MenuManagementTestState.additions
 $global:MenuManagementTestState.failNext = $true
 $failed = $false
 try { & $manager -Action enable -AssetDirectory $assets -Executable $executable | Out-Null }
 catch { $failed = $_.Exception.Message -match 'Simulated deployment failure' }
 Assert $failed 'The failed deployment was not reported.'
 Assert $global:MenuManagementTestState.registered 'A failed update removed the original registration.'
 Assert ($global:MenuManagementTestState.bundle -eq $beforeBundle) 'A failed update changed the rollback snapshot.'
 Assert ($global:MenuManagementTestState.additions -eq $beforeAdds + 2) 'The previous package was not restored.'
 $result = (& $manager -Action disable -AssetDirectory $extendedAssets -Executable $extendedExecutable) | ConvertFrom-Json
 Assert (!$result.enabled -and !$global:MenuManagementTestState.exe -and !$global:MenuManagementTestState.bundle) 'Disable left registration or launch metadata behind.'

 $tampered = Join-Path $testRoot 'tampered'
 $null = [IO.Directory]::CreateDirectory($tampered)
 foreach ($file in Get-ChildItem -LiteralPath $assets -File) { Copy-Item -LiteralPath $file.FullName -Destination $tampered }
 $dll = Get-ChildItem -LiteralPath $tampered -Filter '*.dll' | Select-Object -First 1
 [IO.File]::AppendAllText($dll.FullName, 'tampered')
 $removals = $global:MenuManagementTestState.removals
 $failed = $false
 try { & $manager -Action enable -AssetDirectory $tampered -Executable $executable | Out-Null }
 catch { $failed = $_.Exception.Message -match 'differs from the signed package' }
 Assert $failed 'A modified external extension was accepted.'
 Assert ($global:MenuManagementTestState.removals -eq $removals) 'Invalid resources changed an existing registration.'
 Write-Output 'Management tests passed: enable, failure rollback, disable, and tampered extension rejection.'
} finally {
 if ($snapshot -and !$snapshotExisted -and (Test-Path -LiteralPath $snapshot)) { Remove-Item -LiteralPath $snapshot }
 $resolved = (Resolve-Path -LiteralPath $testRoot).Path
 $cacheRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.cache')).TrimEnd('\') + '\'
 if (!$resolved.StartsWith($cacheRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe management test cleanup path.' }
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
