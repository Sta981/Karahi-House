$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskRows = [Console]::In.ReadToEnd() | ConvertFrom-Json
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $taskSynth.SelectVoice('Microsoft Zira Desktop')
    $taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $taskResults = @()
    foreach ($taskRow in $taskRows) {
        $taskMemory = New-Object System.IO.MemoryStream
        try {
            $taskSynth.SetOutputToAudioStream($taskMemory, $taskFormat)
            $taskText = [System.Security.SecurityElement]::Escape([string]$taskRow.text)
            $taskText = $taskText -replace '\[pause (\d+) ms\]', '<break time="$1ms"/>'
            $taskSynth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">' + $taskText + '</speak>')
            $taskResults += @{ id = $taskRow.id; pcm = [Convert]::ToBase64String($taskMemory.ToArray()); voice = 'Microsoft Zira Desktop' }
        } finally { $taskMemory.Dispose() }
    }
    ConvertTo-Json -InputObject @($taskResults) -Depth 4 -Compress
} finally { $taskSynth.Dispose() }
