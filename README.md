# Job Log: Extensión para registrar tus postulaciones

**Job Log** es una extensión gratuita y de código abierto para Chrome, Brave, Edge, Opera y Firefox de escritorio 140 o posterior. Registra tus postulaciones en una hoja de cálculo de Google Sheets. En LinkedIn obtiene los datos de la oferta (título y empresa) directamente desde la API interna de LinkedIn usando tu propia sesión. En otros portales de empleo usa **Gemini** o **Groq** para extraer la información del texto de la oferta: elegís cuál es la IA principal y la otra queda como respaldo.

La extensión funciona desde tu navegador y se conecta directamente con Google, LinkedIn y los proveedores de IA que configurás. Job Log no opera un servidor intermediario.

---

## Paso 0: Preparar la hoja de cálculo

Antes de instalar la extensión, creá tu copia de la planilla:

1. Abrí la [plantilla de Google Sheets de Job Log](https://docs.google.com/spreadsheets/d/1pmP8vlTjwJwgYJL89mQZGuCMvN2pDb6_9oSI4HjAvPo/template/preview).
2. Hacé clic en **"Utilizar plantilla"** (esquina superior derecha). Esto crea una copia limpia y privada en tu Google Drive.
3. Copiá la **URL completa** de tu nueva planilla desde la barra de direcciones. La vas a necesitar en el Paso 2.

---

## Paso 1: Instalar la extensión

La publicación en Chrome Web Store está en preparación. Mientras tanto, podés probarla en modo desarrollador:

Para **Firefox**, seguí [la guía de instalación temporal y publicación en AMO](./FIREFOX.md). El paquete se genera con `python3 scripts/package.py --browser firefox`; cargá `dist/firefox/manifest.json` desde `about:debugging#/runtime/this-firefox`. La instalación temporal se elimina al cerrar Firefox. La instalación permanente necesita la firma de Mozilla.

1. **Descargá el código:**
   - Con Git: `git clone https://github.com/eduardoemanuelcf/job-log.git`
   - Sin Git: hacé clic en **Code → Download ZIP** y extraé la carpeta donde quieras.

2. **Cargala en tu navegador:**
   - Abrí la página de extensiones de tu navegador:
     - Chrome: `chrome://extensions/`
     - Brave: `brave://extensions/`
     - Edge: `edge://extensions/`
   - Activá **"Modo de desarrollador"** (arriba a la derecha).
   - Hacé clic en **"Cargar descomprimida"** y seleccioná la carpeta del proyecto (la que tiene el archivo `manifest.json`).

![Paso 1: Cargar extensión descomprimida](./docs/assets/01-load-unpacked.png)

---

## Paso 2: Configurar la extensión

### 2.1: Obtener tus API Keys (gratis)

* **Gemini API Key:**
  1. Entrá a [Google AI Studio](https://aistudio.google.com/app/apikey) e iniciá sesión con tu cuenta de Google.
  2. Hacé clic en **"Get API key"** → **"Create API key"**.
* **Groq API Key (opcional):**
  1. Entrá a [Groq Console](https://console.groq.com/keys).
  2. Creá una clave API si querés usar Groq como IA principal, o como respaldo ante caídas o límites de cuota en Gemini.

![Paso 2.1: Obtener API Key en Google AI Studio](./docs/assets/02-1-get-api-key.png)

### 2.2: Cargar tus credenciales

1. Hacé clic en el ícono de la extensión en la barra de herramientas y presioná **Configuración** (o clic derecho → **Opciones**).
2. Completá los campos:
   - **IA principal:** elegí Gemini o Groq. La otra queda como respaldo si cargaste su clave.
   - **Gemini API Key:** pegá tu clave de Gemini.
   - **Groq API Key (opcional):** pegá tu clave de Groq si la tenés.
   - **URL de Google Sheets:** pegá la URL de tu planilla del Paso 0.
3. Hacé clic en **Guardar configuración**. La extensión va a validar las credenciales y queda lista.

![Paso 2: Panel de configuración de credenciales](./docs/assets/02-configuration.png)

---

## Paso 3: Usar la extensión

1. Abrí cualquier oferta de empleo en **LinkedIn** (u otro portal soportado).
2. Hacé clic en el ícono de **Job Log**.
3. Seleccioná la semana. Si querés, desplegá **Nota opcional** y escribí una nota opcional de hasta 2.000 caracteres. Hacé clic en **Registrar postulación**. Al configurar la extensión debés aceptar el uso de datos explicado en el formulario.
4. Job Log extrae empresa, puesto, enlace y origen. puede enviar el texto de la oferta a Gemini o Groq cuando necesita IA.
5. La fila se agrega a tu planilla con estado **En proceso** y la nota en la columna I, **Notas** (el encabezado debe estar en I2). Podés editar esos datos en Google Sheets. La nota no se envía a Gemini ni Groq.
6. Pulsá **Ver progreso** para abrir el gráfico dentro de la extensión. Muestra hasta 12 semanas por período, empezando por las últimas. Usá **Anterior** y **Siguiente** para recorrer tu historial, o **Actualizar** para leer los cambios de tu planilla. En ventanas angostas muestra menos semanas, sin scroll horizontal. Cambiar de período no consulta Sheets y la escala vertical se mantiene para comparar los datos. Durante la carga se muestra un spinner centrado, con el mismo tamaño de contenedor que el gráfico; las etiquetas se acomodan en dos líneas y el tramo visible aparece entre los controles de navegación.

El último borrador de nota se conserva localmente para la misma URL de oferta al cerrar y volver a abrir el popup. Se elimina cuando borrás el texto o cuando se registra correctamente la postulación; se conserva si el registro falla. Es un único borrador: escribir una nota en otra oferta lo reemplaza.

![Paso 3: Extensión en acción](./docs/assets/03-usage-demo.png)

---

## Actualizaciones y publicación

Las instalaciones desde Chrome Web Store o Firefox Add-ons recibirán las versiones publicadas mediante el sistema de actualización del navegador. Un push a GitHub no publica una versión en las tiendas.

Para preparar el ZIP ejecutá `python3 scripts/package.py`. Los archivos y textos de publicación están en [STORE_LISTING.md](./STORE_LISTING.md). Para probar desde el código, descargá la revisión que quieras y recargá la extensión en `chrome://extensions/`.

Para Firefox ejecutá `python3 scripts/package.py --browser firefox`. Ambos paquetes comparten versión y código; el manifest de cada navegador se genera al empaquetar. Ejecutá `node scripts/check.cjs` para verificar los recorridos compartidos y consultá [FIREFOX.md](./FIREFOX.md) para la prueba con el navegador real.

---

## Privacidad y seguridad

### ¿Por qué Google avisa que la extensión puede "ver y editar todas tus hojas de cálculo"?

El flujo actual solicita `https://www.googleapis.com/auth/spreadsheets`, que permite ver, editar, crear y eliminar todas tus hojas de cálculo. Existe el permiso más limitado `drive.file`, pero requiere un flujo de selección/autorización de archivos que esta extensión todavía no implementa.

Sin embargo, el acceso está limitado a nivel de código. Podés revisar el archivo [`popup.js`](./popup.js) y verificar que la extensión solo consulta el ID de la planilla que vos configuraste, y nunca toca ningún otro archivo de tu cuenta.

### Arquitectura sin servidores

La extensión corre completamente en tu navegador. El flujo de datos es directo:

* **En LinkedIn:** el título y la empresa se obtienen de la API interna de LinkedIn (`https://www.linkedin.com/voyager/...`) usando tu sesión ya iniciada, y se guardan directamente en tu Google Sheets. Si no se pueden confirmar esos datos, puede usar la IA como respaldo.
* **En otros portales:** el texto de la oferta se envía a la IA que elegiste como principal (y a la otra como respaldo si falla) para estructurar los datos, que luego se guardan en tu Google Sheets.

Las claves API se envían al proveedor correspondiente para autenticar las solicitudes. Las preferencias y claves se guardan en el almacenamiento sincronizable del navegador. Pueden sincronizarse mediante Chrome Sync o Firefox Sync si habilitaste la sincronización de extensiones; no se transfieren automáticamente entre Brave y Firefox. El token de Google y el correo disponible se guardan localmente. Consultá la [política de privacidad](./PRIVACY.md).

### Código abierto

Podés auditar todo el código en los archivos principales:
* [`manifest.json`](./manifest.json): permisos requeridos: `activeTab`, `storage`, `identity` y `scripting`.
* [`popup.js`](./popup.js): lógica de extracción con Gemini/Groq y guardado en Sheets.
* [`options.js`](./options.js): configuración y almacenamiento de preferencias.
* [`google-auth.js`](./google-auth.js): autenticación compartida para Chrome, Brave y Firefox.
* [`progress.js`](./progress.js): lectura del progreso semanal y gráfico sin dependencias externas.
* [`extension.js`](./extension.js) y [`theme.css`](./theme.css): configuración y estilos compartidos.
