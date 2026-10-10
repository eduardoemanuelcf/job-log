# Job Log en Firefox

Necesitás Firefox de escritorio 140 o posterior, una cuenta de Google, una [copia de la plantilla](https://docs.google.com/spreadsheets/d/1pmP8vlTjwJwgYJL89mQZGuCMvN2pDb6_9oSI4HjAvPo/template/preview) y una clave API de Gemini o Groq. Firefox Android no está incluido.

## Instalar para probar

La instalación disponible desde este repositorio es temporal: se elimina al cerrar Firefox. Para una instalación permanente, el paquete necesita la firma de Mozilla.

1. Descargá el repositorio desde **Code → Download ZIP** y extraelo, o clonalo con Git.
2. Con Python 3 instalado, abrí una terminal en la carpeta del proyecto y ejecutá:

   ```bash
   python3 scripts/package.py --browser firefox
   ```

3. En Firefox, abrí `about:debugging#/runtime/this-firefox`.
4. Pulsá **Cargar complemento temporal** y elegí `manifest.json` dentro de la carpeta `dist/firefox` que generó el comando.

## Configurar y usar

1. Abrí **Job Log → Configuración** desde el menú de extensiones.
2. Pegá la URL de tu copia de la plantilla y una clave API de Gemini o Groq. Elegí la IA principal y aceptá el uso de datos.
3. Pulsá **Autorizar planilla**, seleccioná tu copia en Google y guardá la configuración. Job Log solicita acceso solo a los archivos que autorizás para la app con `drive.file`.
4. Abrí una oferta de empleo, pulsá el icono de Job Log, elegí la semana y seleccioná **Registrar postulación**. Podés añadir una nota opcional.
5. Pulsá **Ver progreso** para consultar tus postulaciones y metas semanales.

Después de autorizarla, el botón pasa a **Cambiar planilla**. Si editás la URL, vuelve a **Autorizar planilla** para el nuevo archivo.

Si tu sesión vence, volvé a conectar la cuenta desde Configuración. Firefox Sync no es necesario y la configuración de otros navegadores no se importa automáticamente.

Encontrá cómo obtener las claves API y más detalles en la [guía general](./README.md#paso-2-configurar-la-extensión). Consultá también la [política de privacidad](./PRIVACY.md).
