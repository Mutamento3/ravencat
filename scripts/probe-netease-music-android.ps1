param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    'inspect',
    'open-song',
    'play-song',
    'open-playlist',
    'play-playlist',
    'web-song',
    'web-playlist',
    'mobile-web-song',
    'mobile-web-playlist',
    'invalid-song',
    'unsupported-route',
    'media-state',
    'media-pause',
    'media-play',
    'media-next',
    'media-previous'
  )]
  [string]$Action,

  [string]$SongId = '186016',
  [string]$PlaylistId = '4925292',
  [string]$Serial = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $prefix = if ($Serial) { @('-s', $Serial) } else { @() }
  & adb @prefix @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "adb command failed: adb $($prefix + $Arguments -join ' ')"
  }
}

function Assert-DeviceReady {
  Get-Command adb -ErrorAction Stop | Out-Null
  if ($Serial) {
    $state = (Invoke-Adb get-state | Out-String).Trim()
    if ($state -ne 'device') { throw "Device $Serial is not ready: $state" }
    return
  }

  $devices = @(& adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" })
  if ($devices.Count -ne 1) {
    throw "Expected exactly one authorized ADB device; found $($devices.Count). Pass -Serial for multiple devices."
  }
}

function Show-Baseline {
  Write-Output '=== device ==='
  Invoke-Adb shell getprop ro.build.version.release
  Invoke-Adb shell getprop ro.build.version.sdk
  Write-Output '=== NetEase package ==='
  $package = Invoke-Adb shell dumpsys package com.netease.cloudmusic
  $matches = @($package | Select-String -Pattern 'versionName=|versionCode=|firstInstallTime=|lastUpdateTime=')
  if ($matches.Count -eq 0) { throw 'com.netease.cloudmusic was not found. Install the official app first.' }
  $matches | ForEach-Object { $_.Line.Trim() }
}

function Invoke-RouteProbe {
  param([string]$Uri)
  Write-Output "=== URI candidate ===`n$Uri"
  Write-Output '=== resolver ==='
  Invoke-Adb shell cmd package query-activities --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d $Uri
  Write-Output '=== dispatch ==='
  Invoke-Adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d $Uri
  Write-Output '=== focused window immediately after dispatch ==='
  Invoke-Adb shell dumpsys window | Select-String -Pattern 'mCurrentFocus|mFocusedApp' | ForEach-Object { $_.Line.Trim() }
  Write-Output 'Record manually: final page, actual playback, chooser, or error page. Successful dispatch does not confirm UI state.'
}

function Show-MediaState {
  Write-Output '=== active media sessions mentioning NetEase ==='
  $dump = Invoke-Adb shell dumpsys media_session
  $matches = @($dump | Select-String -Pattern 'com\.netease\.cloudmusic' -Context 8,30)
  if ($matches.Count -eq 0) {
    Write-Output 'No com.netease.cloudmusic session found. Start playback in the official app and retry.'
    return
  }
  $matches | ForEach-Object {
    $_.Context.PreContext
    $_.Line
    $_.Context.PostContext
  } | Select-Object -Unique
}

function Invoke-MediaKeyProbe {
  param([string]$KeyCode)
  Write-Output "=== dispatch media key: $KeyCode ==="
  Invoke-Adb shell input keyevent $KeyCode
  Write-Output 'ADB shell dispatched the media key. Observe the result, then run media-state as a separate fresh snapshot.'
}

Assert-DeviceReady
Show-Baseline

switch ($Action) {
  'inspect' {
    Write-Output 'Device, Android, and NetEase app versions inspected.'
  }
  'open-song' { Invoke-RouteProbe "orpheus://song/$SongId" }
  'play-song' { Invoke-RouteProbe "orpheus://song/$SongId/?autoplay=1" }
  'open-playlist' { Invoke-RouteProbe "orpheus://playlist/$PlaylistId" }
  'play-playlist' { Invoke-RouteProbe "orpheus://playlist/$PlaylistId/?autoplay=1" }
  'web-song' { Invoke-RouteProbe "https://music.163.com/song?id=$SongId" }
  'web-playlist' { Invoke-RouteProbe "https://music.163.com/playlist?id=$PlaylistId" }
  'mobile-web-song' { Invoke-RouteProbe "https://y.music.163.com/m/song?id=$SongId" }
  'mobile-web-playlist' { Invoke-RouteProbe "https://y.music.163.com/m/playlist?id=$PlaylistId" }
  'invalid-song' { Invoke-RouteProbe 'orpheus://song/999999999999/?autoplay=1' }
  'unsupported-route' { Invoke-RouteProbe 'orpheus://ravencat-phone-8a/unsupported' }
  'media-state' { Show-MediaState }
  'media-pause' { Invoke-MediaKeyProbe 'KEYCODE_MEDIA_PAUSE' }
  'media-play' { Invoke-MediaKeyProbe 'KEYCODE_MEDIA_PLAY' }
  'media-next' { Invoke-MediaKeyProbe 'KEYCODE_MEDIA_NEXT' }
  'media-previous' { Invoke-MediaKeyProbe 'KEYCODE_MEDIA_PREVIOUS' }
}
