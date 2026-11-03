param([switch]$SkipLint)
$ErrorActionPreference = 'Stop'
$mobileRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $mobileRoot '../..')).Path
$buildTemp = Join-Path $repoRoot '.tooling/t'
New-Item -ItemType Directory -Force $buildTemp | Out-Null
$environmentNames = @('TEMP', 'TMP', 'GRADLE_USER_HOME', 'ANDROID_HOME', 'ANDROID_USER_HOME', 'JDK_JAVA_OPTIONS')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location $mobileRoot
try {
    $env:TEMP = $buildTemp
    $env:TMP = $buildTemp
    # Short AF_UNIX paths avoid Java's Windows "Unable to establish loopback connection" failure.
    $env:JDK_JAVA_OPTIONS = '-Djava.io.tmpdir="' + $buildTemp + '" -Djdk.net.unixdomain.tmpdir="' + $buildTemp + '"'
    $env:GRADLE_USER_HOME = Join-Path $repoRoot '.tooling/gradle'
    $env:ANDROID_USER_HOME = Join-Path $repoRoot '.tooling/android-user'
    if (-not $env:ANDROID_HOME) {
        $localSdk = Join-Path $repoRoot '.tooling/android-sdk'
        $standardSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
        if (Test-Path -LiteralPath $localSdk) { $env:ANDROID_HOME = $localSdk }
        elseif (Test-Path -LiteralPath $standardSdk) { $env:ANDROID_HOME = $standardSdk }
        elseif (-not (Test-Path -LiteralPath (Join-Path $mobileRoot 'local.properties'))) { throw 'Install Android SDK 35 or set ANDROID_HOME before building.' }
    }
    $tasks = @(':core:test', ':app:assembleDebug')
    if (-not $SkipLint) { $tasks += ':app:lintDebug' }
    & ./gradlew.bat @tasks --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Android build failed with exit code $LASTEXITCODE" }
    Write-Output (Join-Path $mobileRoot 'app/build/outputs/apk/debug/app-debug.apk')
} finally {
    Pop-Location
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
}
