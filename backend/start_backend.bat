@echo off
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
set PYTHONPATH=%~dp0vendor\MuseAI-API
set SSL_CERT_FILE=C:\temp\certs\cacert.pem
set REQUESTS_CA_BUNDLE=C:\temp\certs\cacert.pem
if not exist "C:\temp\certs" mkdir "C:\temp\certs"
if not exist "C:\temp\certs\cacert.pem" copy ".venv\Lib\site-packages\certifi\cacert.pem" "C:\temp\certs\cacert.pem"
.venv\Scripts\python.exe -X utf8 -u run.py
