@echo off
rem ============================================================
rem BlueWrite — nightly database backup (Phase 4 hardening)
rem Adapted from the starter deliverable for THIS machine:
rem   - Laragon MySQL (the instance that holds the BlueWrite DB)
rem   - 7-day rotation; older .sql files are deleted by this script
rem
rem SETUP (once, on the station server):
rem   1. Fill in DB_USER / DB_PASS below (same values as
rem      config/config.php). NEVER commit this file with a real
rem      password — keep a station-local copy.
rem   2. Create the backup dir (default D:\bluewrite-backups).
rem   3. Register in Windows Task Scheduler: run daily, off-hours:
rem      schtasks /create /tn "BlueWrite nightly backup" ^
rem        /tr "C:\path\to\bluewrite\scripts\backup_db.bat" ^
rem        /sc daily /st 02:30
rem   4. Run it once by hand and VERIFY the .sql file opens
rem      (an untested backup is not a backup).
rem ============================================================

setlocal
set BACKUP_DIR=D:\bluewrite-backups
set DB_NAME=bluewrite
set DB_USER=root
set DB_PASS=
set MYSQLDUMP=C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqldump.exe

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

rem Timestamp format: YYYYMMDD_HHMMSS (locale-independent parts of %date%/%time%)
set TS=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TS=%TS: =0%

"%MYSQLDUMP%" --single-transaction --routines --triggers -u %DB_USER% %DB_PASS% %DB_NAME% > "%BACKUP_DIR%\%DB_NAME%_%TS%.sql"
if errorlevel 1 (
  echo [%date% %time%] BACKUP FAILED for %DB_NAME% >> "%BACKUP_DIR%\backup_errors.log"
  exit /b 1
)

rem ---- Rotation: keep the newest 7 dumps --------------------------
for /f "skip=7 delims=" %%F in ('dir /b /o-n "%BACKUP_DIR%\%DB_NAME%_*.sql" 2^>nul') do (
  del "%BACKUP_DIR%\%%F"
)

echo [%date% %time%] backup OK: %DB_NAME%_%TS%.sql >> "%BACKUP_DIR%\backup.log"
endlocal
