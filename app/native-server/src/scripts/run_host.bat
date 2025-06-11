@echo off
REM Enable delayed expansion to correctly handle variables that are set and read within the same () code block.
setlocal enabledelayedexpansion

REM --- 1. SETUP PATHS AND LOGGING ---

REM Get the directory of this batch script.
set "SCRIPT_DIR=%~dp0"
REM Remove the trailing backslash from the directory path for consistency.
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM Define the log directory relative to the script's location.
set "LOG_DIR=%SCRIPT_DIR%\logs"
REM Define the full path to the Node.js script that will be executed.
set "NODE_SCRIPT=%SCRIPT_DIR%\index.js"

REM Create the log directory if it does not already exist.
if not exist "%LOG_DIR%" (
  md "%LOG_DIR%"
)

REM Generate a timestamp for unique log file names (Format: YYYYMMDD_HHMMSS).
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "TIMESTAMP=%%i"

REM Define the full paths for the wrapper's main log and the stderr log from the Node.js process.
set "WRAPPER_LOG=%LOG_DIR%\native_host_wrapper_windows_%TIMESTAMP%.log"
set "STDERR_LOG=%LOG_DIR%\native_host_stderr_windows_%TIMESTAMP%.log"

REM --- 2. INITIAL DIAGNOSTIC LOGGING ---

echo Wrapper script called at %DATE% %TIME% > "%WRAPPER_LOG%"
echo SCRIPT_DIR: %SCRIPT_DIR% >> "%WRAPPER_LOG%"
echo LOG_DIR: %LOG_DIR% >> "%WRAPPER_LOG%"
echo NODE_SCRIPT: %NODE_SCRIPT% >> "%WRAPPER_LOG%"
echo Initial PATH: %PATH% >> "%WRAPPER_LOG%"
echo User: %USERNAME% >> "%WRAPPER_LOG%"
echo Current PWD: %CD% >> "%WRAPPER_LOG%"

REM --- 3. LOCATE NODE.JS EXECUTABLE (IN ORDER OF PRIORITY) ---

set "NODE_EXEC="

REM Priority 1: Check for a Node.js executable relative to this script's location.
REM This is the most reliable method for packages installed via npm/nvm, as it uses the exact node version the package was installed with.
set "EXPECTED_NODE=%SCRIPT_DIR%\..\..\..\node.exe"
echo Checking for script-relative node at: %EXPECTED_NODE% >> "%WRAPPER_LOG%"
if exist "%EXPECTED_NODE%" (
    set "NODE_EXEC=%EXPECTED_NODE%"
    REM Use !variable! for delayed expansion to get the value set inside this block.
    echo Found script-relative node.exe at !NODE_EXEC! >> "%WRAPPER_LOG%"
)

REM Priority 2: If not found above, search the system's PATH using the 'where' command.
if not defined NODE_EXEC (
    echo Trying 'where node.exe'... >> "%WRAPPER_LOG%"
    for /f "delims=" %%i in ('where node.exe 2^>nul') do (
        if not defined NODE_EXEC (
            set "NODE_EXEC=%%i"
            echo Found node using 'where node.exe': !NODE_EXEC! >> "%WRAPPER_LOG%"
        )
    )
)

REM Priority 3: As a final fallback, check common installation directories.
if not defined NODE_EXEC (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "NODE_EXEC=%ProgramFiles%\nodejs\node.exe"
        echo Found node at !NODE_EXEC! >> "%WRAPPER_LOG%"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE_EXEC=%ProgramFiles(x86)%\nodejs\node.exe"
        echo Found node at !NODE_EXEC! >> "%WRAPPER_LOG%"
    ) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "NODE_EXEC=%LOCALAPPDATA%\Programs\nodejs\node.exe"
        echo Found node at !NODE_EXEC! >> "%WRAPPER_LOG%"
    )
)
:node_found

REM --- 4. VALIDATE AND EXECUTE ---

REM If no Node.js executable was found after all checks, log an error and exit.
if not defined NODE_EXEC (
    echo ERROR: Node.js executable not found! All search methods failed. >> "%WRAPPER_LOG%"
    echo Please ensure Node.js is installed and accessible. >> "%WRAPPER_LOG%"
    exit /B 1
)

echo Using Node executable: %NODE_EXEC% >> "%WRAPPER_LOG%"
echo Node version found by script: >> "%WRAPPER_LOG%"
call "%NODE_EXEC%" -v >> "%WRAPPER_LOG%" 2>>&1

REM Verify that the target Node.js script actually exists before trying to run it.
if not exist "%NODE_SCRIPT%" (
    echo ERROR: The target Node.js script was not found at %NODE_SCRIPT% >> "%WRAPPER_LOG%"
    echo The installation might be corrupt. >> "%WRAPPER_LOG%"
    exit /B 1
)

echo Node.js script exists: %NODE_SCRIPT% >> "%WRAPPER_LOG%"
echo Executing: "%NODE_EXEC%" "%NODE_SCRIPT%" >> "%WRAPPER_LOG%"
echo ==================== Starting Native Host ==================== >> "%WRAPPER_LOG%"

REM Execute the Node.js script.
REM Standard Output is sent to Chrome for Native Messaging communication.
REM Standard Error is redirected to the stderr log file for debugging.
call "%NODE_EXEC%" "%NODE_SCRIPT%" 2>> "%STDERR_LOG%"
set "EXIT_CODE=%ERRORLEVEL%"

echo ==================== Native Host Exited ==================== >> "%WRAPPER_LOG%"
echo Exit code: %EXIT_CODE% >> "%WRAPPER_LOG%"
echo Execution completed at %DATE% %TIME% >> "%WRAPPER_LOG%"

endlocal
exit /B %EXIT_CODE%