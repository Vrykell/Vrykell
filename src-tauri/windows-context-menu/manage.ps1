param(
 [Parameter(Mandatory)][ValidateSet('status','enable','disable','trust','untrust')][string]$Action,
 [Parameter(Mandatory)][string]$AssetDirectory,
 [Parameter(Mandatory)][string]$Executable
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
# Filesystem providers do not accept extended-length paths from native callers.
function ConvertTo-ProviderPath([string]$Path) {
 if ($Path.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) { return '\\' + $Path.Substring(8) }
 if ($Path.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) { return $Path.Substring(4) }
 return $Path
}
$AssetDirectory = ConvertTo-ProviderPath $AssetDirectory
$Executable = ConvertTo-ProviderPath $Executable
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"
Import-Module "$PSHOME/Modules/PKI/PKI.psd1"
Import-Module "$PSHOME/Modules/Appx/Appx.psd1"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$mutex = $null
$locked = $false
if ($Action -ne 'status') {
 $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $mutex = New-Object Threading.Mutex($false, "Local\Vrykell.ContextMenu.$sid")
 try { $locked = $mutex.WaitOne(30000) }
 catch [Threading.AbandonedMutexException] { $locked = $true }
 if (!$locked) { $mutex.Dispose(); throw 'Another context menu operation is still running. Try again after it finishes.' }
}
try {
$key = 'HKCU:/Software/Vrykell/ContextMenu'
$packagePath = Join-Path $AssetDirectory 'Vrykell.ContextMenu.msix'
$certificatePath = Join-Path $AssetDirectory 'Vrykell.ContextMenu.cer'
$snapshotDirectory = Join-Path $env:LOCALAPPDATA 'com.vrykell.app/context-menu/packages'
function Get-StreamHash([IO.Stream]$Stream) {
 $hash = [Security.Cryptography.SHA256]::Create()
 try { return [BitConverter]::ToString($hash.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
 finally { $hash.Dispose() }
}
function Get-FileDigest([string]$Path) {
 $stream = [IO.File]::OpenRead($Path)
 try { return Get-StreamHash $stream } finally { $stream.Dispose() }
}
$supported = [Environment]::OSVersion.Version.Build -ge 22000
$available = (Test-Path -LiteralPath $packagePath) -and (Test-Path -LiteralPath $certificatePath)
$certificate = $null
if ($available) {
 $archive = $null
 try {
  $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certificatePath)
  if ($certificate.Subject -ne 'CN=Vrykell') { throw 'Unexpected certificate publisher.' }
  $archive = [IO.Compression.ZipFile]::OpenRead($packagePath)
  $entry = $archive.GetEntry('AppxManifest.xml')
  if (!$entry -or $entry.Length -gt 1048576) { throw 'Invalid identity manifest.' }
  $settings = New-Object Xml.XmlReaderSettings
  $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $stream = $entry.Open()
  $reader = [Xml.XmlReader]::Create($stream, $settings)
  try {
   $manifest = New-Object Xml.XmlDocument
   $manifest.XmlResolver = $null
   $manifest.Load($reader)
  } finally { $reader.Dispose(); $stream.Dispose() }
  $identity = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
  if (!$identity -or $identity.GetAttribute('Name') -ne 'Vrykell.ContextMenu' -or $identity.GetAttribute('Publisher') -ne 'CN=Vrykell') { throw 'Unexpected package identity.' }
  $class = $manifest.SelectSingleNode("//*[local-name()='Class' and @Id='8D41BA19-3B2F-4D6D-A96B-FE3AD0EC5821']")
  if (!$class) { throw 'The extension class is missing.' }
  $relativePath = $class.GetAttribute('Path')
  if ($relativePath -notmatch '^windows-context-menu\\VrykellExplorerCommand-[0-9a-f]{16}\.dll$') { throw 'Invalid extension path.' }
  $dllName = [IO.Path]::GetFileName($relativePath)
  $dllPath = Join-Path $AssetDirectory $dllName
  $payload = $archive.GetEntry($relativePath.Replace('\', '/'))
  if (!$payload) { throw 'The signed package is missing its extension.' }
  $stream = $payload.Open()
  try { $expectedDllHash = Get-StreamHash $stream } finally { $stream.Dispose() }
  if ($dllName -ne "VrykellExplorerCommand-$($expectedDllHash.Substring(0,16)).dll") { throw 'Invalid extension digest.' }
  $available = Test-Path -LiteralPath $dllPath
 } catch { $available = $false }
 finally { if ($archive) { $archive.Dispose() } }
}
$packages = @(Get-AppxPackage -Name 'Vrykell.ContextMenu' | Where-Object { $_.Publisher -eq 'CN=Vrykell' })
$registeredExe = (Get-ItemProperty -LiteralPath $key -Name Executable -ErrorAction SilentlyContinue).Executable
$previousBundle = (Get-ItemProperty -LiteralPath $key -Name Bundle -ErrorAction SilentlyContinue).Bundle
function Get-Trust {
 if (!$certificate) { return $false }
 return Test-Path "Cert:/LocalMachine/TrustedPeople/$($certificate.Thumbprint)"
}
function Assert-PackageSignature {
 $signature = Get-AuthenticodeSignature -LiteralPath $packagePath
 if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or
     $signature.Status -in @('HashMismatch', 'NotSigned', 'NotSupportedFileFormat')) { throw 'The package signature does not match the bundled certificate.' }
 if ($certificate.NotBefore -gt (Get-Date) -or $certificate.NotAfter -le (Get-Date)) { throw 'The signing certificate is expired or not yet valid. Update the application before trusting its certificate.' }
}
function Set-CertificateTrust([bool]$Trust) {
 if (!$certificate -or $certificate.Subject -ne 'CN=Vrykell') { throw 'The bundled public certificate is missing or invalid.' }
 $escapedPath = $certificatePath.Replace("'", "''")
 $thumbprint = $certificate.Thumbprint
 $operation = if ($Trust) {
  "`$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('$escapedPath'); if (`$cert.Thumbprint -ne '$thumbprint' -or `$cert.Subject -ne 'CN=Vrykell') { throw 'Certificate changed.' }; Import-Certificate -FilePath '$escapedPath' -CertStoreLocation Cert:/LocalMachine/TrustedPeople | Out-Null"
 } else { "Remove-Item -LiteralPath 'Cert:/LocalMachine/TrustedPeople/$thumbprint' -ErrorAction SilentlyContinue" }
 $script = "`$ErrorActionPreference = 'Stop'; try { Import-Module `"`$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1`"; Import-Module `"`$PSHOME/Modules/PKI/PKI.psd1`"; $operation; exit 0 } catch { exit 1 }"
 $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
 $process = Start-Process -FilePath "$PSHOME/powershell.exe" -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
     -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded)
 if ($process.ExitCode -ne 0) { throw 'Windows could not update certificate trust.' }
}
if ($Action -in @('enable','trust') -and !$supported) { throw 'The modern context menu requires Windows 11.' }
if ($Action -in @('trust','enable') -and !$available) { throw 'The signed context menu resources are missing or invalid. Prepare them before packaging the application.' }
if ($Action -eq 'trust') {
 Assert-PackageSignature
 Set-CertificateTrust $true
}
if ($Action -eq 'enable') {
 if (!(Get-Trust)) { throw 'Trust the bundled public certificate before enabling the context menu.' }
 if (!(Test-Path -LiteralPath $Executable -PathType Leaf)) { throw 'The application executable is missing.' }
 Assert-PackageSignature
 if ((Get-FileDigest $dllPath) -ne $expectedDllHash) { throw 'The extension differs from the signed package.' }
 $externalDirectory = [IO.Path]::GetDirectoryName($Executable)
 $dllDirectory = Join-Path $externalDirectory 'windows-context-menu'
 $destination = Join-Path $dllDirectory $dllName
 if ([IO.Path]::GetFullPath($destination) -ne [IO.Path]::GetFullPath($dllPath) -and
     (!(Test-Path -LiteralPath $destination) -or (Get-FileDigest $destination) -ne $expectedDllHash)) {
  $null = [IO.Directory]::CreateDirectory($dllDirectory)
  Copy-Item -LiteralPath $dllPath -Destination $destination -Force
 }
 $null = [IO.Directory]::CreateDirectory($snapshotDirectory)
 $digest = Get-FileDigest $packagePath
 $snapshot = Join-Path $snapshotDirectory "$digest.msix"
 if (!(Test-Path -LiteralPath $snapshot)) { Copy-Item -LiteralPath $packagePath -Destination $snapshot }
 elseif ((Get-FileDigest $snapshot) -ne $digest) { throw 'The cached package snapshot is corrupted.' }
 $canRestore = $packages.Count -gt 0 -and $registeredExe -and $previousBundle -and
     (Test-Path -LiteralPath $registeredExe) -and (Test-Path -LiteralPath $previousBundle)
 if ($canRestore) {
  $previousFullPath = [IO.Path]::GetFullPath($previousBundle)
  $cachePrefix = [IO.Path]::GetFullPath($snapshotDirectory).TrimEnd('\') + '\'
  $canRestore = $previousFullPath.StartsWith($cachePrefix, [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($previousBundle) -eq "$(Get-FileDigest $previousBundle).msix"
 }
 $removed = $false
 $newRegistered = $false
 try {
  # Immutable DLL names avoid overwriting code still loaded by the shell.
  foreach ($package in $packages) { Remove-AppxPackage -Package $package.PackageFullName }
  $removed = $true
  Add-AppxPackage -Path $snapshot -ExternalLocation $externalDirectory
  $newRegistered = $true
  $null = New-Item -Path $key -Force
  $null = New-ItemProperty -LiteralPath $key -Name Executable -Value $Executable -PropertyType String -Force
  $null = New-ItemProperty -LiteralPath $key -Name Bundle -Value $snapshot -PropertyType String -Force
 } catch {
  $failure = $_.Exception.Message
  if ($newRegistered) {
   try {
    Get-AppxPackage -Name 'Vrykell.ContextMenu' | Where-Object { $_.Publisher -eq 'CN=Vrykell' } | Remove-AppxPackage
   } catch { throw "Registration failed and cleanup of the incomplete registration failed: $failure; $($_.Exception.Message)" }
  }
  if ($canRestore -and $removed) {
   try {
    Add-AppxPackage -Path $previousBundle -ExternalLocation ([IO.Path]::GetDirectoryName($registeredExe))
    $null = New-Item -Path $key -Force
    $null = New-ItemProperty -LiteralPath $key -Name Executable -Value $registeredExe -PropertyType String -Force
    $null = New-ItemProperty -LiteralPath $key -Name Bundle -Value $previousBundle -PropertyType String -Force
   } catch { throw "Registration failed and the previous registration could not be restored: $failure; $($_.Exception.Message)" }
  } elseif ($newRegistered -and !$registeredExe) {
   Remove-ItemProperty -LiteralPath $key -Name Executable,Bundle -ErrorAction SilentlyContinue
  }
  throw $failure
 }
}
if ($Action -eq 'disable' -and $registeredExe -eq $Executable) {
 foreach ($package in $packages) { Remove-AppxPackage -Package $package.PackageFullName }
 if (Test-Path -LiteralPath $key) { Remove-ItemProperty -LiteralPath $key -Name Executable,Bundle -ErrorAction SilentlyContinue }
}
if ($Action -eq 'untrust') {
 if ($packages.Count -gt 0) { throw 'Disable the context menu before removing certificate trust.' }
 if ($certificate -and (Test-Path "Cert:/LocalMachine/TrustedPeople/$($certificate.Thumbprint)")) { Set-CertificateTrust $false }
}
$packages = @(Get-AppxPackage -Name 'Vrykell.ContextMenu' | Where-Object { $_.Publisher -eq 'CN=Vrykell' })
$registeredExe = (Get-ItemProperty -LiteralPath $key -Name Executable -ErrorAction SilentlyContinue).Executable
@{ supported = $supported; available = $available; enabled = ($packages.Count -gt 0 -and $registeredExe -eq $Executable);
 certificateTrusted = (Get-Trust); certificateThumbprint = $(if ($certificate) { $certificate.Thumbprint } else { $null }) } | ConvertTo-Json -Compress
} finally {
 if ($mutex) { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}
