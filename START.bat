@echo off
chcp 65001 > nul
cd /d "%~dp0"
where npm > nul 2>&1
if errorlevel 1 (
  echo Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b
)
if not exist node_modules (
  echo 처음 실행이라 필요한 파일을 설치합니다. 1~2분 걸립니다...
  call npm install
)
rem 최신 npm은 설치 스크립트를 막아 Electron 실행 파일이 안 받아질 수 있음
if not exist node_modules\electron\dist\electron.exe (
  echo Electron 실행 파일을 받습니다...
  call node node_modules\electron\install.js
)
call npm start
