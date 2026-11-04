# Cazadores y recolectores

Una aplicación local de visualización de datos organizada en columnas por categoría.

## Cómo iniciarla

Desde este directorio, iniciá la aplicación con Docker Compose:

    docker compose up --build -d

Después, abrí http://192.168.2.1:8765. Compose publica el puerto en la interfaz VPN privada, como hacía el servidor antes de Docker. Para detenerla:

    docker compose down

Los datos y archivos multimedia permanecen en `data/`, montados dentro del contenedor.

Para ejecutar el servidor directamente sin Docker:

    python3 server.py

Después, abrí la dirección que muestra el servidor. Por defecto escucha en 192.168.2.1:8765, como está configurado para la VPN privada.

La aplicación usa HTML, CSS y JavaScript sin frameworks, junto con un pequeño servidor Python de la biblioteca estándar. La búsqueda revisa la colección local primero y consulta iNaturalist solo si no hay una coincidencia local exacta. Al agregar un taxón desde iNaturalist, el servidor guarda sus nombres disponibles, la ruta taxonómica, las fotos con atribución/licencia, el estado de conservación disponible, las fechas de observación, las anotaciones y las coordenadas públicas. Los observadores no se guardan. Las fechas se agrupan por día y mes para mostrar cuándo se registró la especie; el mapa muestra las observaciones con coordenadas. Cada importación recupera hasta 10.000 observaciones, el máximo consultado por esta función. Las entradas aparecen contraídas; expandirlas muestra el registro y seleccionar su nombre abre la ficha local con los detalles recuperados. Al guardar registros de especies con taxonomía, el rango Especie es obligatorio. Un nombre científico o común que coincide con iNaturalist completa automáticamente los rangos taxonómicos.

## Categorías

- Hongos
- Hierbas y tés
- Plantas

Usá **Nueva categoría** para crear otra vista y elegir sus campos. Se pueden quitar, repetir y renombrar campos. Los tipos disponibles son Nombres (varios valores, uno por línea), Ubicación, Coordenadas (varios puntos por registro), Imágenes, Videos, Descripción, Taxonomía (rangos separados desde reino hasta especie) y Perfil de interacción (marcas independientes para usos alimentarios, medicinales, psicoactivos o recreativos, toxicidad, protección, regulación y otros usos humanos). Los videos e imágenes se guardan como archivos locales. Las coordenadas se muestran en un mapa esquemático dentro de la aplicación y en una vista ampliada. Cada categoría nueva se guarda como un JSON independiente en data/; también se persisten sus campos y su posición en la colección. Las columnas se pueden reordenar arrastrando el control de puntos y contraer o expandir desde el encabezado.
