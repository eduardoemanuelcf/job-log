# Política de privacidad de Job Log

Última actualización: 8 de octubre de 2026. Aplicable a las versiones de Chrome, Brave, Edge, Opera y Firefox de escritorio.

La página pública de privacidad está en https://job-log.emanuelcabral.dev/privacy. Este documento incluye el funcionamiento de Firefox y puede utilizarse como texto de privacidad en AMO.

Job Log procesa el texto y la URL de la oferta que elegís, datos de postulaciones, tokens de Google, el correo disponible y claves API. Puede enviar texto a Gemini o Groq para extraer los datos y guardar las postulaciones directamente en tu Google Sheets. En LinkedIn consulta la oferta usando tu sesión. si no confirma los datos, puede recurrir a IA.

Las notas opcionales se guardan junto a la postulación en la columna Notas de tu planilla. No se envían a Gemini ni Groq. La página Progreso consulta las cantidades de postulaciones y las metas semanales de esa misma planilla para dibujar el gráfico dentro de la extensión. No guarda otra copia de esos datos ni modifica la planilla.

Las claves API autentican las solicitudes al proveedor correspondiente. El token de Google autentica las consultas y escrituras en la planilla configurada. El correo disponible puede utilizarse para mostrar la cuenta conectada y sugerirla al volver a autenticar con Google. En LinkedIn, el lector utiliza la cookie de sesión necesaria para consultar esa misma plataforma. Job Log no opera un servidor intermediario ni incorpora publicidad o telemetría.

Las claves y preferencias se guardan en `storage.sync`, el almacenamiento sincronizable del navegador. Pueden sincronizarse mediante Chrome Sync o Firefox Sync si habilitaste la sincronización de extensiones. No se transfieren automáticamente entre Brave y Firefox. Los tokens, su vencimiento, el correo y las semanas en caché se guardan en `storage.local` del perfil donde instalaste Job Log. También se conserva un único borrador de nota local, asociado a la URL de la oferta. No se sincroniza; solo se recupera al abrir el popup en esa misma URL. Escribir una nota en otra oferta reemplaza ese borrador. Se elimina al borrar el texto o al registrar correctamente la postulación.

Los datos permanecen hasta que los borres o desinstales la extensión. Cerrar sesión elimina el token y correo locales, pero no borra la planilla, las claves ni las preferencias. Podés borrar las claves desde la configuración, eliminar los datos de la extensión o desinstalarla y revocar el acceso de Job Log desde los controles de tu cuenta Google. Las filas ya guardadas se eliminan desde Google Sheets; los datos sincronizados también están sujetos a los controles de la cuenta del navegador.

La lectura de una oferta ocurre cuando pulsás Registrar postulación. Job Log no registra el historial general ni lee otras pestañas en segundo plano. La IA puede recibir hasta 6.000 caracteres del texto de la oferta, junto con el título y empresa detectados. Las consultas de semanas y objetivos utilizan la planilla que configuraste. Google concede el scope de acceso a todas tus hojas de cálculo, aunque el código utiliza la planilla elegida.

El tratamiento de datos por Google, LinkedIn, Gemini y Groq está sujeto a las políticas y condiciones de esos proveedores. Las solicitudes de autenticación, las postulaciones guardadas y el texto enviado a la IA van directamente desde tu navegador a los servicios involucrados.

Firefox 140 o posterior muestra las categorías de datos transmitidos al instalar la extensión. Además, la configuración requiere aceptar el uso de datos antes de guardar las preferencias y habilitar el registro de postulaciones.

Contacto: eduardoemanuelcf@gmail.com.
