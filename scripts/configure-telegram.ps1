$ErrorActionPreference = 'Stop'
$repository = 'SCMM-MTE/observatorio-metro-madrid'

function Read-PlainToken {
    $secureToken = Read-Host 'Pega el token entregado por BotFather (no se mostrara)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Invoke-TelegramApi {
    param(
        [Parameter(Mandatory)] [string] $Token,
        [Parameter(Mandatory)] [string] $Method,
        [hashtable] $Body
    )

    $parameters = @{
        Uri = "https://api.telegram.org/bot$Token/$Method"
        Method = 'Post'
        ContentType = 'application/json'
    }
    if ($Body) {
        $parameters.Body = $Body | ConvertTo-Json -Depth 5 -Compress
    }
    Invoke-RestMethod @parameters
}

Clear-Host
Write-Host 'CONFIGURAR AVISOS DE TELEGRAM' -ForegroundColor Cyan
Write-Host 'El token solo permanecera en memoria durante este asistente.'
Write-Host ''

$token = Read-PlainToken
try {
    try {
        $identity = Invoke-TelegramApi -Token $token -Method 'getMe'
    }
    catch {
        throw 'Telegram no ha aceptado el token. Comprueba que lo copiaste completo desde BotFather.'
    }
    if (-not $identity.ok) {
        throw 'Telegram no ha validado el bot.'
    }

    Write-Host "Bot validado: @$($identity.result.username)" -ForegroundColor Green
    Write-Host 'Asegurate de haber abierto ese bot y enviado /start.' -ForegroundColor Yellow
    Read-Host 'Pulsa INTRO para buscar la conversacion'

    $updates = Invoke-TelegramApi -Token $token -Method 'getUpdates'
    $chats = @(
        $updates.result | ForEach-Object {
            if ($_.message.chat) { $_.message.chat }
            if ($_.edited_message.chat) { $_.edited_message.chat }
            if ($_.channel_post.chat) { $_.channel_post.chat }
            if ($_.my_chat_member.chat) { $_.my_chat_member.chat }
        } | Where-Object { $null -ne $_.id } | Sort-Object id -Unique
    )

    if ($chats.Count -eq 0) {
        throw 'No se encontro ninguna conversacion. Envia /start al bot y vuelve a ejecutar el asistente.'
    }

    Write-Host ''
    Write-Host 'Conversaciones encontradas:' -ForegroundColor Cyan
    foreach ($chat in $chats) {
        $label = (@($chat.first_name, $chat.last_name, $chat.title, $chat.username) | Where-Object { $_ }) -join ' '
        Write-Host "  ID $($chat.id)  $label  [$($chat.type)]"
    }

    if ($chats.Count -eq 1) {
        $chatId = [string]$chats[0].id
        $confirmation = Read-Host "Usar el chat $chatId? (S/n)"
        if ($confirmation -and $confirmation -notmatch '^[sS]$') {
            $chatId = Read-Host 'Escribe el ID del chat que deseas usar'
        }
    }
    else {
        $chatId = Read-Host 'Escribe el ID del chat que deseas usar'
    }

    if ($chatId -notmatch '^-?[0-9]+$') {
        throw 'El ID del chat no es valido.'
    }

    $token | gh secret set TELEGRAM_BOT_TOKEN --repo $repository
    if ($LASTEXITCODE -ne 0) { throw 'GitHub no pudo guardar TELEGRAM_BOT_TOKEN.' }
    $chatId | gh secret set TELEGRAM_CHAT_ID --repo $repository
    if ($LASTEXITCODE -ne 0) { throw 'GitHub no pudo guardar TELEGRAM_CHAT_ID.' }

    $test = Invoke-TelegramApi -Token $token -Method 'sendMessage' -Body @{
        chat_id = $chatId
        text = "Avisos activados`n`nEl Observatorio Metro te notificara cuando encuentre una nueva publicacion."
        disable_web_page_preview = $true
    }
    if (-not $test.ok) { throw 'Telegram no pudo enviar el mensaje de prueba.' }

    Write-Host ''
    Write-Host 'CONFIGURACION COMPLETADA' -ForegroundColor Green
    Write-Host 'Comprueba que has recibido el mensaje de prueba en Telegram.'
}
catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    $token = $null
    [GC]::Collect()
    Read-Host 'Pulsa INTRO para cerrar'
}
