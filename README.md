# Observatorio Metro

Webapp pública que reúne y permite consultar publicaciones oficiales relacionadas con Metro de Madrid procedentes de:

- [Sede Oficial del BOCM](https://www.bocm.es/)
- [Portal de Contratación Pública de la Comunidad de Madrid](https://contratos-publicos.comunidad.madrid/)
- [Empleo Metro](https://www.metromadrid.es/es/empleo-metro)

La recolección se ejecuta automáticamente cada 30 minutos mediante GitHub Actions. Los metadatos se guardan en `public/data/archive.json`, de modo que el histórico es visible, versionable y exportable. Los documentos se consultan siempre en su fuente oficial.

## Funcionamiento

1. El BOCM se consulta mediante su RSS de sumarios y los XML oficiales de cada boletín.
2. Contratación se consulta mediante el feed ATOM/CODICE oficial y el buscador filtrado por `Metro de Madrid, S.A.`.
3. Empleo Metro se monitoriza para archivar convocatorias y extraer el número de plazas por puesto.
4. Los registros se normalizan y fusionan por URL/identificador estable.
5. Una publicación ya archivada nunca se elimina porque desaparezca de un feed reciente.
6. Si una fuente falla, el archivo anterior se conserva y la incidencia queda visible en el estado de la fuente.

## Avisos por Telegram

Cuando hay publicaciones nuevas, el workflow puede enviar un resumen inmediato por Telegram. En las convocatorias de empleo incluye el número de plazas desglosado por puesto.

El repositorio espera dos secretos de GitHub Actions:

- `TELEGRAM_BOT_TOKEN`: token creado con `@BotFather`.
- `TELEGRAM_CHAT_ID`: identificador del chat que ha iniciado una conversación con el bot.

Los secretos se configuran en **Settings → Secrets and variables → Actions**. No deben guardarse en archivos, commits ni mensajes públicos. Las ejecuciones incrementales avisan únicamente de identificadores que aún no estaban archivados; una reconstrucción histórica no envía notificaciones.

## Desarrollo local

```bash
npm install
npm run ingest
npm run dev
```

Comprobaciones:

```bash
npm test
npm run check:data
npm run build
```

## Histórico y automatización

- `npm run ingest`: consulta incremental para la ejecución de cada 30 minutos.
- `npm run backfill`: recorre las páginas históricas disponibles en los buscadores oficiales.
- El workflow `Recolectar publicaciones` también puede ejecutarse manualmente desde GitHub con la opción de reconstrucción histórica.

GitHub puede retrasar unos minutos las tareas programadas en momentos de alta carga. La expresión configurada es `*/30 * * * *`.

## Alcance

Es un proyecto independiente de reutilización de información pública. No representa a Metro de Madrid ni a la Comunidad de Madrid. Los metadatos ayudan a localizar información, pero el documento enlazado en la fuente oficial es siempre la referencia válida.
