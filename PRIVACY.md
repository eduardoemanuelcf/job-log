# Política de Privacidad de Job Log

Última actualización: 1 de junio de 2026

En Job Log, valoramos y respetamos tu privacidad. Esta Política de Privacidad describe cómo se manejan tus datos al utilizar la extensión.

## 1. Recopilación de Información
Job Log es una herramienta que funciona en su totalidad de forma local en tu navegador. 
* **No recopilamos datos personales:** No registramos, almacenamos ni recopilamos nombres, correos electrónicos, historiales de navegación ni ninguna otra información de identificación personal.
* **Sin servidores intermediarios:** La extensión no utiliza servidores propios ni bases de datos externas para procesar tus datos.

## 2. Uso y Almacenamiento de Credenciales
Para funcionar, la extensión requiere que ingreses dos datos en la configuración: una **Gemini API Key** y la **URL de tu Google Sheets**.
* **Almacenamiento Local:** Estos datos se guardan exclusivamente en el almacenamiento local y seguro de tu propio navegador (`chrome.storage.local`).
* **Acceso Privado:** Tus credenciales nunca son enviadas a nosotros ni a terceros. Su único propósito es autenticar tus peticiones locales directamente ante las APIs oficiales de Google Gemini y Google Sheets.

## 3. Transferencia de Datos
El flujo de información es directo y encriptado entre tu navegador y los servicios involucrados:
* En LinkedIn, el título y la empresa de la oferta se leen directamente desde la API interna de LinkedIn (`https://www.linkedin.com/voyager/...`) usando tu sesión activa en el navegador. Para estas ofertas no se utiliza Gemini.
* En otros portales de empleo, el texto de la oferta se envía temporalmente a la API oficial de Google Gemini (`https://generativelanguage.googleapis.com`) para estructurar los datos del empleo.
* Los datos estructurados se envían directamente a tu cuenta de Google Sheets a través de la API oficial de Google Sheets (`https://sheets.googleapis.com`).

## 4. Cambios en esta Política
Nos reservamos el derecho de actualizar esta política en cualquier momento. Cualquier cambio será publicado en este repositorio.

## 5. Contacto
Si tienes alguna duda o quieres auditar el código fuente, puedes acceder de forma abierta a este repositorio de GitHub.
