@echo off
title Instalador do Monitor de Rede

echo ============================================================
echo             Instalador do Monitor de Rede
echo ============================================================
echo.

:: Precisa de Administrador para instalar o motor de captura e o firewall
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Solicitando permissoes de Administrador...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~dpnx0\"\"' -Verb RunAs"
    exit /b
)

echo [1/4] Verificando o motor de captura (Wireshark/Npcap)...
if exist "C:\Program Files\Wireshark\tshark.exe" goto tshark_ok
if exist "C:\Program Files (x86)\Wireshark\tshark.exe" goto tshark_ok

echo       Nao encontrado. Instalando automaticamente (pode levar 1-2 minutos)...
winget install -e --id WiresharkFoundation.Wireshark --silent --accept-package-agreements --accept-source-agreements
if exist "C:\Program Files\Wireshark\tshark.exe" (
    echo       Wireshark/Npcap instalado com sucesso!
) else (
    echo       [!] Nao foi possivel instalar automaticamente.
    echo           Instale o Wireshark manualmente: https://www.wireshark.org/download.html
    echo           Durante a instalacao, mantenha a opcao "Npcap" marcada.
)
goto after_tshark

:tshark_ok
echo       Motor de captura ja instalado.

:after_tshark
echo.
echo [2/4] Liberando o Monitor no Firewall do Windows...
netsh advfirewall firewall delete rule name="Monitor Infantil" >nul 2>&1
netsh advfirewall firewall add rule name="Monitor Infantil" dir=in action=allow program="%~dp0dist\MonitorInfantil.exe" enable=yes >nul 2>&1
netsh advfirewall firewall delete rule name="Monitor Infantil DNS" >nul 2>&1
netsh advfirewall firewall add rule name="Monitor Infantil DNS" dir=in action=allow protocol=UDP localport=53 >nul 2>&1
echo       Firewall configurado.

echo.
echo [3/4] Criando atalho na Area de Trabalho...
set "TARGET=%~dp0dist\MonitorInfantil.exe"
set "SHORTCUT=%USERPROFILE%\Desktop\Monitor de Rede.lnk"
set "WORKDIR=%~dp0dist"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%WORKDIR%'; $s.Description = 'Monitor de Rede'; $s.Save()" >nul 2>&1
if exist "%SHORTCUT%" (echo       Atalho criado.) else (echo       Nao foi possivel criar o atalho.)

echo.
echo [4/4] Iniciando o Monitor de Rede...
start "" "%TARGET%"

echo.
echo ============================================================
echo  Tudo pronto!
echo.
echo  AGORA, PARA MONITORAR O CELULAR DA CRIANCA:
echo   1. Ligue o "Ponto de acesso movel" do Windows.
echo   2. Conecte o celular da crianca nessa rede Wi-Fi.
echo   3. Acompanhe tudo no painel que abriu no navegador.
echo ============================================================
echo.
pause
