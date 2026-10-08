# Job Log en Firefox

Versión 1.13. Firefox de escritorio 140 o posterior. Chrome y Firefox comparten código y versión en este repo; cada tienda tiene su propio paquete e identidad. Firefox Android no está incluido en esta entrega.

## Generar e instalar para probar

```bash
node scripts/check.cjs
python3 scripts/package.py --browser firefox
npx --yes web-ext@10.7.0 lint --source-dir dist/firefox
```

El resultado es `dist/job-log-firefox-1.13.zip` y la carpeta `dist/firefox/`. El manifest está en la raíz del ZIP; contiene solo los archivos de ejecución, sin documentación, perfiles, resultados de pruebas ni credenciales privadas.

1. Abrí Firefox y entrá a `about:debugging#/runtime/this-firefox`.
2. Elegí **Cargar complemento temporal** y seleccioná `dist/firefox/manifest.json`.
3. Abrí Job Log desde el menú de extensiones y luego Configuración.
4. Usá una copia de la plantilla, pegá su URL y una clave Gemini o Groq, aceptá el uso de datos y guardá.
5. Conectá tu cuenta Google y aceptá el acceso a Sheets. Firefox Sync no es necesario. Las sesiones y configuraciones de Brave no se importan automáticamente.
6. Abrí una oferta, pulsá el icono de Job Log, elegí una semana y registrá la postulación.

El botón Iniciar sesión del popup abre Configuración. La conexión interactiva se realiza en esa página, que permanece abierta mientras Google muestra su ventana de autenticación. Si la sesión venció y no puede renovarse en silencio, volvé a conectar desde Configuración y abrí nuevamente el popup.

La instalación temporal se elimina al cerrar Firefox. Para desarrollo también podés ejecutar:

```bash
npx --yes web-ext@10.7.0 run --source-dir dist/firefox
```

Para iniciar sesión realmente en Google, preferí Firefox abierto normalmente y la carga manual desde `about:debugging`. WebDriver y los lanzadores con control remoto pueden provocar el rechazo de Google «This browser or app may not be secure». El script automático usa únicamente un proveedor OAuth local de prueba; no intenta iniciar una sesión real en Google.

## Google OAuth

ID estable del complemento: `job-log@emanuelcabral.dev`. No cambiarlo después de publicar: determina la identidad, almacenamiento y redirección OAuth.

Firefox usa el cliente **web** existente, configurado en `oauth-config.js`:

```text
73095001022-nvvtlk9rb4h9v4jn3bmq05grejcgdl2k.apps.googleusercontent.com
```

La URI autorizada en Google Auth Platform → Clientes → ese cliente web debe coincidir exactamente, sin slash final:

```text
http://127.0.0.1/mozoauth2/8195073c8f01f77de12ba02e7863b718a89d4c5c
```

Conservá las URIs de Chrome/Brave. El cliente de tipo Chrome Extension sigue configurado en el manifest base para Chrome. El paquete Firefox no incluye `oauth2` ni `key`; los scopes del flujo web se toman de la configuración compartida.

Firefox intercepta la redirección loopback: Job Log no levanta un servidor en el equipo del usuario. No hace falta agregar un secreto de cliente ni cargar código remoto. La respuesta debe coincidir con la redirección y el `state` generado; se rechazan errores de autorización, permisos parciales de Sheets y vencimientos inválidos.

La URI se comprobó en Firefox 153.0.1. El 8 de octubre de 2026 Google mostró su formulario de inicio de sesión después de registrar la URI, sin `redirect_uri_mismatch`. El usuario confirmó la conexión con una cuenta real en Firefox abierto sin control remoto y el registro de una postulación con una fila correcta en su Google Sheets.

Si la app Google está en modo de prueba, la cuenta usada debe estar habilitada como usuario de prueba. Antes de publicar para usuarios externos, completar la verificación OAuth del permiso de Sheets y probar una cuenta externa. La firma de Mozilla no sustituye esa verificación.

## Pruebas reproducibles

Para probar el paquete instalado en un perfil aislado de Firefox, usá el binario oficial de [geckodriver](https://github.com/mozilla/geckodriver/releases):

```bash
python3 scripts/check-firefox.py --geckodriver /ruta/a/geckodriver
```

El script usa Python estándar, Firefox y geckodriver. No requiere Selenium ni modifica el perfil habitual. `--headed` muestra las ventanas de pruebas. Usa credenciales y respuestas sintéticas; no solicita claves privadas ni modifica una planilla real.

Comprueba instalación, consentimiento, intercepción OAuth nativa, conexión/desconexión, objetivo y creación de semanas, persistencia al reiniciar Firefox, permiso `activeTab`, inyección real del lector y registro con respuestas simuladas de IA/Sheets. También comprueba el respaldo Gemini → Groq y llamadas reales a los cuatro servicios con credenciales inválidas para detectar errores de CORS o red.

Los resultados y capturas quedan en `dist/firefox-tests/`. Los checks compartidos de Node cubren Chrome y Firefox, validación OAuth, renovación de tokens, datos de entrada y protección contra fórmulas inyectadas en Sheets.

La conexión Google y un registro real en Sheets fueron confirmados por el usuario en la versión 1.12. Las pruebas automáticas de la 1.13 incluyen notas, recuperación del borrador, columnas verticales, metas, navegación por períodos sin consultas adicionales, ventana angosta sin scroll horizontal, etiquetas sin superposición, spinner de carga y estados vacíos y de error. Usan respuestas sintéticas para la escritura de notas, los proveedores de IA y las operaciones de semanas y objetivos; esa cobertura no equivale a haber probado estas funciones nuevas con una cuenta real. Antes de publicar, comprobar una nota y el gráfico con una planilla de prueba. No colocar claves, tokens o contraseñas en Git, capturas públicas o la ficha de AMO.

## Publicar en Firefox Add-ons

1. Ingresá a [AMO Developer Hub](https://addons.mozilla.org/developers/) desde Brave o Firefox y elegí **Submit a New Add-on → On this site**.
2. Subí `dist/job-log-firefox-1.13.zip`. Elegí Firefox de escritorio como plataforma compatible.
3. Reutilizá nombre, resumen y descripción de `STORE_LISTING.md`, reemplazando Chrome Sync por almacenamiento sincronizable del navegador. Aclará los requisitos: cuenta Google, copia de la plantilla y clave Gemini o Groq.
4. Adjuntá capturas de Firefox con datos de prueba. Las capturas automáticas muestran un recorrido simulado; no prueban que Google haya autorizado una cuenta real.
5. Para la privacidad, copiá el contenido de `PRIVACY.md` en el campo de AMO. Antes de usar la URL pública como referencia de esta versión, actualizar esa página con el texto que contempla Firefox, notas y progreso.
6. Elegí licencia personalizada y utilizá el texto de licencia existente en la sección 5 de `TERMS.md`. No hay un archivo de licencia SPDX en este repo.
7. El JavaScript distribuido es legible y no se transpila ni minifica. Si AMO pide las fuentes, aportá una copia limpia del repo y el comando de empaquetado, excluyendo perfiles y credenciales.
8. Agregá las instrucciones para revisores que siguen y enviá a revisión. Una vez firmado/publicado, instalá desde AMO y repetí la conexión Google y un registro real.

La instalación permanente en Firefox estable necesita un paquete firmado por Mozilla. Para siguientes versiones, actualizá el mismo complemento; incrementá la versión base y generá ambos ZIPs. Subir a AMO no publica en Chrome Web Store.

### Instrucciones para revisores

```text
Job Log has a Spanish UI and records job applications in the user's own Google Sheet.

1. Create a copy of the public template:
https://docs.google.com/spreadsheets/d/1pmP8vlTjwJwgYJL89mQZGuCMvN2pDb6_9oSI4HjAvPo/template/preview
2. Open Configuración, enter the copied Sheet URL and a Gemini or Groq API key, select the provider, accept the data disclosure and save.
3. Click Conectar cuenta and authenticate with Google. Firefox Sync is not required. The extension uses identity.launchWebAuthFlow with a Firefox-supported loopback redirect intercepted by Firefox; there is no local HTTP server or client secret.
4. Open a job posting, click the extension icon, select a week and press Registrar postulación. Optionally expand Nota opcional before registering. Check the new row in Postulaciones, including the note in column I (Notas). Notes are not sent to AI providers. Click Ver progreso to open the weekly bar chart in a tab; Actualizar reads the configured sheet without modifying it.
5. In settings, change the weekly goal and add a week. Check the changes in Progreso or Progreso semanal.
6. Cerrar sesión removes the local Google token and email; it keeps settings and existing Sheet rows.

LinkedIn extraction may require the user's LinkedIn session. If the offer cannot be confirmed, its text is sent directly to the configured AI provider. All executable code is packaged locally. There is no Job Log server, advertising, analytics or remotely loaded code.

The shared JavaScript includes guarded Chrome identity methods for the Chrome package. In Firefox those methods are absent and the web flow is used. The Android compatibility lint warning does not apply to the desktop-only listing; the manifest has no gecko_android section.
```

Si el revisor necesita una clave de prueba, aportarla únicamente en los campos privados de revisión con cuota limitada. Nunca incluirla en el paquete o en la descripción pública.

Documentación oficial: [identidad y loopback](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity), [consentimiento de datos](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) y [publicación en AMO](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
