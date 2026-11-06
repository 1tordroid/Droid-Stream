<#
  One-time release signing setup for Droid Stream (run on your own PC).

  Creates a release keystore, then stores the four GitHub Actions secrets the
  release and nightly workflows need:
    KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD
  at repository level and in the "nightly" environment.

  Needs: GitHub CLI signed in (gh auth login) and keytool (from a JDK, or
  Android Studio's bundled JBR).

  KEEP THE KEYSTORE AND PASSWORD SAFE. Every future update must be signed
  with this same key, or Android refuses to install it over the old app.

  Usage (from the repo folder):
    powershell -ExecutionPolicy Bypass -File scripts\setup-release-signing.ps1
#>
param(
  [string]$Repo = '1tordroid/Droid-Stream',
  [string]$Alias = 'droidstream',
  [string]$KeystorePath = "$HOME\droid-stream-release.keystore"
)
$ErrorActionPreference = 'Stop'

function Find-Keytool {
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:JAVA_HOME\bin\keytool.exe",
    "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe",
    "$env:ProgramFiles\Android\Android Studio\jre\bin\keytool.exe",
    "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\keytool.exe"
  )
  foreach ($path in $candidates) { if ($path -and (Test-Path $path)) { return $path } }
  throw 'keytool not found. Install a JDK 17 or Android Studio, or set JAVA_HOME.'
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is not installed: https://cli.github.com' }
gh auth status | Out-Null
$keytool = Find-Keytool

if (Test-Path $KeystorePath) {
  Write-Host "Using the existing keystore at $KeystorePath"
  $secure = Read-Host 'Keystore password' -AsSecureString
} else {
  $secure = Read-Host 'Choose a keystore password (8+ characters, write it down)' -AsSecureString
  $plainCheck = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ($plainCheck.Length -lt 8) { throw 'Password must be at least 8 characters.' }
  $confirm = Read-Host 'Repeat the password' -AsSecureString
  $plainConfirm = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm))
  if ($plainCheck -ne $plainConfirm) { throw 'Passwords do not match.' }
}
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

if (-not (Test-Path $KeystorePath)) {
  & $keytool -genkeypair -v -storetype PKCS12 -keystore $KeystorePath -alias $Alias `
    -keyalg RSA -keysize 4096 -validity 10000 `
    -storepass $password -keypass $password `
    -dname 'CN=Tordroid, OU=Droid Stream, O=Tordroid, L=Unknown, ST=Unknown, C=IN'
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed.' }
  Write-Host "Created $KeystorePath"
}

$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($KeystorePath))

# The nightly workflows read secrets from the "nightly" environment.
gh api -X PUT "repos/$Repo/environments/nightly" | Out-Null

$secrets = @{ KEYSTORE_BASE64 = $base64; KEYSTORE_PASSWORD = $password; KEY_ALIAS = $Alias; KEY_PASSWORD = $password }
foreach ($name in $secrets.Keys) {
  $secrets[$name] | gh secret set $name --repo $Repo
  $secrets[$name] | gh secret set $name --repo $Repo --env nightly
  Write-Host "Set $name"
}

Write-Host ''
Write-Host 'Done. Back up these two things somewhere safe (password manager, USB drive):'
Write-Host "  1. $KeystorePath"
Write-Host '  2. The password you typed'
Write-Host 'Then tag a release (for example: git tag v5.3.3; git push origin v5.3.3) to build a signed APK.'
