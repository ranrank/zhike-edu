param(
    [ValidateSet('Validate', 'Install', 'Restore')]
    [string]$Action = 'Validate'
)
$ErrorActionPreference = 'Stop'
$datasetDirectory = $PSScriptRoot
$commonDirectory = Join-Path (Split-Path $datasetDirectory -Parent) 'common'
$classesDirectory = Join-Path ([IO.Path]::GetTempPath()) ('ragent-campus-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $classesDirectory | Out-Null
$sources = @((Get-ChildItem -LiteralPath $commonDirectory -Filter '*.java').FullName) +
    @((Get-ChildItem -LiteralPath $datasetDirectory -Filter '*.java').FullName)
$javaExecutable = 'java'
$javacExecutable = 'javac'
if ($env:JAVA_HOME) {
    $javaExecutable = Join-Path $env:JAVA_HOME 'bin/java.exe'
    $javacExecutable = Join-Path $env:JAVA_HOME 'bin/javac.exe'
}
& $javacExecutable -encoding UTF-8 -d $classesDirectory @sources
if ($LASTEXITCODE -ne 0) { throw '教务初始化器编译失败' }
$mainClass = if ($Action -eq 'Restore') { 'CampusRestoreMain' } else { 'CampusInitMain' }
$javaArguments = @('-Dfile.encoding=UTF-8', '-cp', $classesDirectory,
    ('com.nageoffer.ai.ragent.initializer.' + $mainClass), '--agent-type-dir', $datasetDirectory)
if ($Action -eq 'Validate') { $javaArguments += '--dry-run' }
& $javaExecutable @javaArguments
if ($LASTEXITCODE -ne 0) { throw "教务初始化器执行失败：$Action" }
