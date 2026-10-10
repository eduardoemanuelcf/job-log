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
2. Ingresá una clave API de Gemini o Groq, elegí la IA principal, aceptá el uso de datos y pulsá **Guardar claves**. El paso queda completo y aparece **Conectar tu planilla**.
3. Pulsá **Autorizar planilla** y seleccioná tu copia en Google: queda guardada automáticamente. Job Log solicita acceso solo a los archivos que autorizás para la app con `drive.file`.

   Si todavía no tenés tu copia, abrí el enlace **plantilla de Job Log** en **Conectar tu planilla**, pulsá **Utilizar plantilla** en Google y volvé a la configuración para autorizarla.
4. En **Elegir el objetivo semanal**, elegí cuántos CVs querés enviar por semana y pulsá **Guardar objetivo**. Cuando se guarda en Sheets y en la configuración, Job Log indica que está listo. El aviso aparece solo al completar la configuración inicial y desaparece al refrescar o volver a abrir la página.
5. Abrí una oferta de empleo, pulsá el icono de Job Log, elegí la semana y seleccioná **Registrar postulación**. Podés añadir una nota opcional.
6. Pulsá **Ver progreso** para consultar tus postulaciones y metas semanales.

El asistente aparece solo durante la configuración inicial. Después, las secciones quedan desplegadas para editar las claves, cambiar la planilla y guardar el objetivo directamente. **Abrir planilla** abre la selección actual y **Cerrar sesión** permite desconectar la cuenta. Al elegir otra planilla, confirmá el objetivo para esa selección; el asistente no vuelve a aparecer.

Si Sheets no permite guardar el objetivo, aparece una advertencia y tus claves y selección se conservan. Revisá la conexión y pulsá **Guardar objetivo** para reintentar. La configuración retoma el paso pendiente al volver a abrirla y conserva los ajustes existentes.

Si tu sesión vence, volvé a conectar la cuenta desde Configuración. Firefox Sync no es necesario y la configuración de otros navegadores no se importa automáticamente.

Encontrá cómo obtener las claves API y más detalles en la [guía general](./README.md#paso-2-configurar-la-extensión). Consultá también la [política de privacidad](./PRIVACY.md).
