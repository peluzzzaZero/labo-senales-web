# Labo de señales · aplicación estática

Instrumento de aceleración/giro del navegador, importación CSV y exploración de frecuencias con señales sintéticas explícitas. Sin dependencias externas ni envío de muestras. La captura solo comienza por botón y permiso estándar, si existe. Sin mediciones del Samsung S25, diagnóstico ni ML validado.

Esta carpeta es un candidato de entrega web; no acredita que esté publicada. Requiere un origen HTTP local confiable o HTTPS real para la vía de sensores. No abrir como archivo suelto: usa módulos y un worker. La ejecución y permisos en Android están pendientes de prueba.

Las muestras viven en memoria; recargar las borra. Exportar JSON es manual. Un alojamiento web recibe visitas/metadatos y puede registrar direcciones IP; que las muestras no se envíen no oculta la visita al proveedor. No hay cuentas, tracking añadido, backend de muestras, cámara, micrófono ni escaneos.

Para CSV: timestamp_ms,x,y,z; aceleración en m/s² declarada; milisegundos crecientes, sin vacíos ni repetidos; máximo 512 KiB y 2048 filas. Para espectro: al menos 128 muestras y cadencia dentro de los límites mostrados. La señal irregular no se interpola. El giro conserva °/s; no se confunde con orientación.

El caso de aliasing y las demás fórmulas se generan solo al elegirlos. No hay banco QA accesible por URL. Sin datasets, benchmarks, grabaciones, modelos, claves ni documentación de investigación. Código original bajo MIT.
