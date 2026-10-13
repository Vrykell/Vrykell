param([Parameter(Mandatory)][string]$StagingDirectory, [Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"
Import-Module "$PSHOME/Modules/PKI/PKI.psd1"
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$sdk = Get-ChildItem -LiteralPath $sdkRoot -Directory | Where-Object { $_.Name -match '^10\.' } |
    Sort-Object { [version]$_.Name } -Descending | Where-Object { Test-Path (Join-Path $_.FullName 'x64/makeappx.exe') } | Select-Object -First 1
if (!$sdk) { throw 'Install the Windows SDK with MakeAppx and SignTool.' }
$certificate = Get-ChildItem Cert:/CurrentUser/My | Where-Object {
    $_.Subject -eq 'CN=Vrykell' -and $_.FriendlyName -eq 'Vrykell context menu development signing' -and
    $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30)
} | Sort-Object NotAfter -Descending | Select-Object -First 1
if (!$certificate) {
    $certificate = New-SelfSignedCertificate -Subject 'CN=Vrykell' -Type CodeSigningCert -HashAlgorithm SHA256 `
        -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy NonExportable -CertStoreLocation Cert:/CurrentUser/My `
        -FriendlyName 'Vrykell context menu development signing' -NotAfter (Get-Date).AddYears(5)
}
$packagePath = Join-Path $OutputDirectory 'Vrykell.ContextMenu.msix'
& (Join-Path $sdk.FullName 'x64/makeappx.exe') pack /o /nv /d $StagingDirectory /p $packagePath
if ($LASTEXITCODE -ne 0) { throw 'Identity package creation failed.' }
& (Join-Path $sdk.FullName 'x64/signtool.exe') sign /fd SHA256 /s My /sha1 $certificate.Thumbprint $packagePath
if ($LASTEXITCODE -ne 0) { throw 'Identity package signing failed.' }
Export-Certificate -Cert $certificate -FilePath (Join-Path $OutputDirectory 'Vrykell.ContextMenu.cer') | Out-Null
Write-Output 'Signed identity package prepared. The private signing key remains in the user certificate store.'
