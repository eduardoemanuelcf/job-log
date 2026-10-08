# Publicación de Job Log en Chrome Web Store

## Estado del paquete

Versión 1.13, con notas opcionales y gráfico de progreso dentro de la extensión. La versión anterior ya fue enviada a revisión: conservá ese envío y su ZIP; publicá esta versión como actualización cuando corresponda. Los cambios locales no modifican el paquete enviado. La verificación de marca no equivale a verificar el permiso sensible de Sheets. Los clientes OAuth y scopes existentes se conservan. Para Firefox, consultar [FIREFOX.md](./FIREFOX.md).

```bash
node scripts/check.cjs
python3 scripts/package.py
```

Subir `dist/job-log-1.13.zip` en https://chrome.google.com/webstore/devconsole. El ZIP contiene solo los archivos de ejecución. no incluye Git, documentos, hooks, tests, claves API ni el aviso de actualización. El cliente OAuth es un identificador público y sí se incluye.

## Primer borrador e identidad OAuth

ID del elemento: `ibmpgpcbdcabaeblnjocephjlhcfjhdd`.

Cliente OAuth incorporado: `73095001022-ldfsn9ckghqa4nr01bii35f78168l895.apps.googleusercontent.com`. La clave pública local corresponde al ID del elemento. Falta comprobar en Google Cloud que el cliente OAuth esté vinculado a ese ID y probar la conexión real.

1. Crear la cuenta de desarrollador, pagar el registro y completar los requisitos que muestre el panel.
2. Crear un nuevo elemento y subir el ZIP como borrador.
3. Copiar el ID asignado a ese elemento. En **Package → View public key**, obtener la clave pública completa para usar ese mismo ID en pruebas locales. reemplazar `key` en el manifest local. No crear otro elemento para las siguientes cargas.
4. En Google Auth Platform → Clients, crear o configurar un cliente OAuth de tipo **Chrome Extension** para ese ID. Poner su client ID en `manifest.json → oauth2.client_id`. La clave pública permite mantener ese ID en pruebas locales. El empaquetador la excluye del ZIP.
5. Volver a empaquetar. Si el panel exige una versión mayor para reemplazar el borrador, incrementarla en `manifest.json`. el nombre del ZIP se ajusta automáticamente.
6. Mantener activada Google Sheets API. En Audience, preparar la app externa para **En producción**. En Data Access y Verification Center, solicitar aprobación de `https://www.googleapis.com/auth/spreadsheets`. el flujo alternativo también pide `email`, que debe estar declarado.
7. Usar las URLs públicas que siguen y verificar su dominio. Grabar un video con consentimiento OAuth en inglés, permisos y flujo completo: conectar, registrar una postulación, consultar semanas, cambiar objetivo y añadir semana. Mostrar únicamente una planilla y claves de prueba. no publicar tokens ni claves.
8. Tras la aprobación, probar OAuth y escritura real con una cuenta que no sea usuario de prueba.

No se sustituye Sheets por `drive.file`: el flujo actual usa una URL pegada y no implementa la selección/autorización de archivos que ese permiso necesita.

## Conexión en Brave y flujo web alternativo

El cliente de tipo Extensión de Chrome queda en `manifest.json → oauth2.client_id` para `getAuthToken`. El flujo con `launchWebAuthFlow`, usado por Brave y por el botón de conexión, utiliza el cliente web existente configurado en `oauth-config.js`.

Cliente web: `73095001022-nvvtlk9rb4h9v4jn3bmq05grejcgdl2k.apps.googleusercontent.com`.

En Google Auth Platform → Clientes → JobLog Client Extension 2 → URIs de redireccionamiento autorizados, agregar exactamente `https://ibmpgpcbdcabaeblnjocephjlhcfjhdd.chromiumapp.org/` y guardar. Mantener las direcciones existentes si todavía se usan para desarrollo. El slash final forma parte de la URL que devuelve `getRedirectURL()`.

Ambos IDs de cliente son públicos. El ZIP no contiene secretos de cliente. La revisión del permiso de Sheets se realiza en el mismo proyecto y el video debe mostrar el cliente que corresponde al recorrido grabado.

## Datos de la ficha

Nombre: **Job Log**

Idioma: **Español**. Categoría: elegir la opción del panel correspondiente a productividad y organización de tareas.

Descripción corta (también en el manifest):

> Registrá postulaciones desde la oferta en tu Google Sheets y organizá tu búsqueda por semanas con Gemini o Groq.

Descripción detallada para copiar:

```text
Registrá tus postulaciones laborales desde la página de la oferta y mantené tu búsqueda organizada en Google Sheets.

Job Log guarda fecha, empresa, puesto, enlace, origen, semana y una nota opcional en la planilla que configurás. Las notas van directamente a Sheets y no se envían a la IA. Desde «Ver progreso» podés consultar un gráfico de postulaciones y metas por semana dentro de la extensión. Cada registro empieza con estado «En proceso». podés editarlo directamente en Google Sheets. Desde la configuración también podés cambiar tu objetivo semanal y añadir semanas al panel de progreso.

Cómo empezar:
1. Creá una copia de la plantilla de Job Log y pegá su URL en la configuración.
2. Conectá tu cuenta de Google.
3. Configurá una clave API de Gemini o Groq y revisá el uso de datos.
4. Abrí una oferta, elegí la semana, añadí una nota si querés y pulsá «Registrar postulación».
5. Pulsá «Ver progreso» para consultar tus postulaciones frente a la meta semanal.

En LinkedIn, Job Log intenta obtener los datos usando tu sesión iniciada. Cuando no puede confirmar los datos de la oferta, envía hasta 6.000 caracteres de texto de la página a Gemini o Groq para extraer empresa y puesto. Si configuraste ambas claves, puede usar el otro proveedor como respaldo.

La extensión requiere una cuenta de Google, una copia de la plantilla y una clave API de Gemini o Groq. Las cuotas, disponibilidad y posibles cargos de esos proveedores dependen de tu cuenta. Job Log no incluye créditos de IA.

Privacidad y permisos:
• Solo lee la página elegida cuando pulsás «Registrar postulación». no registra la navegación en segundo plano.
• Google solicita acceso a todas tus hojas de cálculo. El código de Job Log dirige las solicitudes a la planilla configurada. el permiso OAuth sigue siendo amplio.
• Las claves y preferencias se guardan en Chrome Sync y pueden sincronizarse entre navegadores. El token de Google y el correo disponible se guardan localmente.
• Las postulaciones se guardan en tu Google Sheets. Las llamadas van directamente a los servicios involucrados, sin un servidor intermediario de Job Log.
• El código de la extensión no incluye publicidad ni telemetría.

Guía: https://github.com/eduardoemanuelcf/job-log#readme
Privacidad: https://job-log.emanuelcabral.dev/privacy
Soporte: eduardoemanuelcf@gmail.com
```

Homepage URL: `https://job-log.emanuelcabral.dev/`

Support URL: `https://job-log.emanuelcabral.dev/#support-title`

Privacy Policy URL: `https://job-log.emanuelcabral.dev/privacy`

Terms: `https://job-log.emanuelcabral.dev/terms`

## Privacy practices: textos para copiar

Propósito único:

> Registrar postulaciones laborales desde la oferta elegida por el usuario en su Google Sheets y organizar ese registro por semanas y objetivos.

| Permiso | Justificación |
| --- | --- |
| `activeTab` | Permite acceder temporalmente a la pestaña elegida cuando el usuario activa Job Log. La extensión lee la oferta únicamente al pulsar Registrar postulación, para extraer texto, URL, empresa y puesto. También cubre las consultas a LinkedIn desde esa página. no hay acceso permanente a todos los sitios. |
| `scripting` | Ejecuta el lector de la oferta en la pestaña activa tras la acción del usuario. Lee el DOM y, en LinkedIn, consulta los detalles de la oferta usando la sesión activa. |
| `storage` | Guarda preferencias, claves API, planilla, objetivo, semana y aceptación del uso de datos en Chrome Sync, y token de Google, vencimiento, correo disponible y semanas en almacenamiento local. |
| `identity` | Autentica al usuario con Google mediante Chrome Identity para consultar y modificar su planilla configurada. El flujo alternativo solicita también email para identificar la cuenta. |

Host permissions: ninguna. `activeTab` da el acceso temporal necesario a la página elegida.

Remote code: **No**. Todo JavaScript ejecutable está incluido en el paquete. Las APIs remotas devuelven datos. no se evalúan ni cargan scripts remotos. No hay aviso remoto de GitHub.

Tipos de datos a declarar por su tratamiento, aunque no lleguen al desarrollador:

* **Personally identifiable information:** correo de la cuenta conectada cuando Google lo facilita.
* **Authentication information:** token OAuth, claves API y cookie de sesión de LinkedIn usada para la consulta a ese servicio.
* **Web history:** URL de la oferta elegida que se guarda como parte de la postulación. no se solicita permiso `history` ni se recopila el historial general.
* **Website content:** texto de la página, título, empresa y datos de la oferta. contenido de la planilla necesario para registrar y organizar postulaciones.

La extensión no registra clics, movimientos del mouse ni pulsaciones generales: no declarar **User activity** por ese tipo de seguimiento. Revisar las definiciones del panel si cambian antes de enviar. No declarar salud, finanzas, comunicaciones personales ni ubicación por funcionalidades que este paquete no implementa.

Confirmar las declaraciones de no venta, uso limitado al propósito único y ausencia de uso para crédito. El uso de datos se limita a las funcionalidades descritas y las transferencias necesarias a Google, LinkedIn y los proveedores de IA configurados. No marcar «no maneja datos».

## Test instructions: texto para revisores

```text
Job Log has a Spanish UI. It records job applications in the user's own Google Sheet.

1. Create your own copy using this public template:
https://docs.google.com/spreadsheets/d/1pmP8vlTjwJwgYJL89mQZGuCMvN2pDb6_9oSI4HjAvPo/template/preview
2. Open the extension's Configuración page. Enter that Sheet URL and a Gemini or Groq API key, select the provider, read the disclosure and check the consent checkbox. Save settings and connect your own Google account.
3. Open a job posting, open Job Log, select a week and click Registrar postulación. The extension appends a row in Postulaciones with date, company, week, role, hyperlink, initial status En proceso, source, and an optional note in column I (Notas). Notes are not sent to AI providers. Open Ver progreso to view weekly applications and goals; Actualizar reads the configured sheet without modifying it.
4. In settings, change the weekly goal and add a week. Confirm the changes in the Progreso/Progreso semanal tab of your copy.
5. Cerrar sesión clears the cached Google token and email. it does not delete Sheet rows or settings.

The extension requires a Google account and a Gemini or Groq API key. it has no separate Job Log login or subscription. LinkedIn's own session may be needed to read a LinkedIn posting. When extraction cannot confirm the offer, configured AI services are used. All executable code is bundled locally. no GitHub update service is used.
```

Si el panel/revisor pide credenciales para reproducir el flujo, aportar una clave de prueba con cuota y una planilla de prueba únicamente en los campos privados de revisión. Esos datos no van en el ZIP, la ficha, el repositorio ni las capturas. No se generaron ni se inventaron credenciales de prueba.

## Imágenes y envío

Usar el icono 128×128, la imagen promocional 440×280 y las capturas 1280×800 adjuntas al paquete de publicación. Las capturas deben mostrar la versión preparada y datos ficticios identificados como demostración. nunca claves reales.

Elegir visibilidad Pública y las regiones deseadas, completar los requisitos de la cuenta y, después de resolver identidad/OAuth y probar el flujo real, enviar a revisión. Un push al repositorio no publica ni actualiza el elemento. Para cada actualización, aumentar `version`, subir el nuevo ZIP al mismo elemento y enviarlo a revisión.

## Fuentes oficiales

* https://developer.chrome.com/docs/webstore/publish
* https://developer.chrome.com/docs/webstore/prepare
* https://developer.chrome.com/docs/webstore/images
* https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
* https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
* https://developer.chrome.com/docs/extensions/how-to/integrate/oauth
* https://developers.google.com/workspace/sheets/api/scopes
