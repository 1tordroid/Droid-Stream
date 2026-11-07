param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [ValidateSet('arm64-v8a', 'armeabi-v7a')]
    [string]$Abi = 'arm64-v8a',
    [string]$GoExecutable = 'go',
    [string]$NdkDirectory = "$env:ANDROID_SDK_ROOT/ndk/27.1.12297006"
)

$ErrorActionPreference = 'Stop'
$revision = '6aa03fc97d12848dce34eedbd187fb1077b5d1ea' # Diniboy1123/usque v1.5.1-0.20260720063354-6aa03fc97d12 (upstream HEAD, newer than tag v4.2.1)
$goVersion = 'go1.27.3'
# Module bumps applied on top of upstream's go.mod (go get <module>@latest + go mod tidy, 2026-11-07).
# x/sys moves with them as a dependency.
$moduleBumps = [ordered]@{
    'golang.org/x/net'    = 'v0.62.0' # upstream v0.56.0
    'golang.org/x/crypto' = 'v0.58.0' # upstream v0.53.0
    'golang.org/x/text'   = 'v0.43.0' # upstream v0.38.0
}
$expectedModules = [ordered]@{}
foreach ($name in $moduleBumps.Keys) { $expectedModules[$name] = $moduleBumps[$name] }
$expectedModules['golang.org/x/sys'] = 'v0.49.0' # upstream v0.46.0
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$actualRevision = & git -C $source rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $actualRevision -ne $revision) {
    throw "Expected usque at commit $revision"
}
# Only go.mod/go.sum may differ from upstream (left over from an earlier run of this script).
$changes = & git -C $source status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Cannot read usque checkout status' }
$unexpected = @($changes | Where-Object { $_ -notmatch '^ M (go\.mod|go\.sum)$' })
if ($unexpected.Count -gt 0) { throw "usque source checkout must be clean apart from go.mod/go.sum: $unexpected" }
$actualGo = & $GoExecutable env GOVERSION
if ($LASTEXITCODE -ne 0 -or $actualGo -ne $goVersion) { throw "Expected $goVersion, found $actualGo" }

$savedToolchain = [Environment]::GetEnvironmentVariable('GOTOOLCHAIN', 'Process')
$savedFlags = [Environment]::GetEnvironmentVariable('GOFLAGS', 'Process')
Push-Location $source
try {
    $env:GOTOOLCHAIN = 'local'
    Remove-Item Env:GOFLAGS -ErrorAction SilentlyContinue
    $targets = foreach ($name in $moduleBumps.Keys) { "$name@$($moduleBumps[$name])" }
    & $GoExecutable get @targets
    if ($LASTEXITCODE -ne 0) { throw 'go get of the pinned module bumps failed' }
    & $GoExecutable mod tidy
    if ($LASTEXITCODE -ne 0) { throw 'go mod tidy failed' }
    foreach ($name in $expectedModules.Keys) {
        $resolved = & $GoExecutable list -m -f '{{.Version}}' $name
        if ($LASTEXITCODE -ne 0 -or $resolved -ne $expectedModules[$name]) {
            throw "Expected $name $($expectedModules[$name]), found $resolved"
        }
    }
} finally {
    Pop-Location
    [Environment]::SetEnvironmentVariable('GOTOOLCHAIN', $savedToolchain, 'Process')
    [Environment]::SetEnvironmentVariable('GOFLAGS', $savedFlags, 'Process')
}

$tools = Join-Path $NdkDirectory 'toolchains/llvm/prebuilt/windows-x86_64/bin'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root "performance-captures/usque-build/$Abi/libusque.so"
New-Item -ItemType Directory -Force (Split-Path $output -Parent) | Out-Null

# arm64 is a static Go executable. Go cannot link android/arm without cgo, so the 32-bit build
# uses the NDK clang as external linker (the result is a PIE linked against libc/libdl/liblog).
$saved = @{}
foreach ($name in 'GOOS', 'GOARCH', 'GOARM', 'CGO_ENABLED', 'CC', 'GOFLAGS', 'GOTOOLCHAIN') {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    $env:GOOS = 'android'
    $env:GOFLAGS = '-mod=readonly'
    $env:GOTOOLCHAIN = 'local'
    if ($Abi -eq 'armeabi-v7a') {
        $env:GOARCH = 'arm'
        $env:GOARM = '7'
        $env:CGO_ENABLED = '1'
        $env:CC = Join-Path $tools 'armv7a-linux-androideabi24-clang.cmd'
    } else {
        $env:GOARCH = 'arm64'
        Remove-Item Env:GOARM -ErrorAction SilentlyContinue
        $env:CGO_ENABLED = '0'
    }
    Push-Location $source
    try {
        & $GoExecutable build -trimpath -ldflags '-s -w' -o $output .
        if ($LASTEXITCODE -ne 0) { throw 'usque compilation failed' }
    } finally {
        Pop-Location
    }
} finally {
    foreach ($name in $saved.Keys) {
        [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
    }
}

$headers = & "$tools/llvm-readelf.exe" -W -h -l $output
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect usque ELF headers' }
$expectedClass = if ($Abi -eq 'armeabi-v7a') { 'ELF32' } else { 'ELF64' }
$expectedMachine = if ($Abi -eq 'armeabi-v7a') { 'ARM' } else { 'AArch64' }
$expectedInterpreter = if ($Abi -eq 'armeabi-v7a') { '/system/bin/linker(?!\d)' } else { '/system/bin/linker64' }
if (!($headers -match "Class:\s+$expectedClass\b")) { throw "Expected $expectedClass binary" }
if (!($headers -match "Machine:\s+$expectedMachine\b")) { throw "Expected $expectedMachine binary" }
if (!($headers -match $expectedInterpreter)) { throw 'Missing Android executable interpreter' }
if (!($headers -match 'Type:\s+DYN\b')) { throw 'usque must be a PIE executable' }
$buildInfo = & $GoExecutable version -m $output
if ($LASTEXITCODE -ne 0) { throw 'Cannot read usque build info' }
if (!($buildInfo -match ":\s+$([regex]::Escape($goVersion))$")) { throw "usque was not built with $goVersion" }
foreach ($name in $expectedModules.Keys) {
    $pattern = "^\s+dep\s+$([regex]::Escape($name))\s+$([regex]::Escape($expectedModules[$name]))\s"
    if (!($buildInfo -match $pattern)) { throw "usque build info lacks $name $($expectedModules[$name])" }
}

$destination = Join-Path $root "native-src/android/jniLibs/$Abi/libusque.so"
New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
Copy-Item -LiteralPath $output -Destination $destination -Force
# Keep an existing generated Android project in sync; Expo prebuild also copies this file.
$generated = Join-Path $root "android/app/src/main/jniLibs/$Abi/libusque.so"
if (Test-Path -LiteralPath (Split-Path $generated -Parent)) {
    Copy-Item -LiteralPath $output -Destination $generated -Force
}
Write-Output "usque ($Abi) rebuilt: ELF class, machine and interpreter checks pass."
Get-FileHash -LiteralPath $destination -Algorithm SHA256
