# Cazadores y recolectores

Una aplicación local de visualización de datos organizada en columnas por categoría.

## Cómo iniciarla

Desde este directorio, ejecutá:

    python3 server.py

Después, abrí la dirección que muestra el servidor. Actualmente escucha en 192.168.2.1:8765, como está configurado para la VPN privada.

La aplicación usa HTML, CSS y JavaScript sin frameworks, junto con un pequeño servidor Python de la biblioteca estándar. Cada categoría tiene su propio conjunto de datos JSON legible en data/. Las imágenes se guardan como archivos en data/images/. El orden y el estado contraído de las categorías se guardan en data/category-view.json. La aplicación no guarda datos en el almacenamiento del navegador.

## Categorías

- Hongos
- Hierbas y tés
- Plantas

Usá **Nueva categoría** para crear otra vista y elegir sus campos. Se pueden quitar, repetir y renombrar campos. Los tipos disponibles son Nombres (varios valores, uno por línea), Ubicación, Coordenadas (varios puntos por registro), Imágenes, Videos, Descripción, Taxonomía (rangos separados desde reino hasta especie) y Perfil de interacción (marcas independientes para usos alimentarios, medicinales, psicoactivos o recreativos, toxicidad, protección, regulación y otros usos humanos). Los videos e imágenes se guardan como archivos locales. Las coordenadas se muestran en un mapa esquemático dentro de la aplicación y en una vista ampliada. Cada categoría nueva se guarda como un JSON independiente en data/; también se persisten sus campos y su posición en la colección. Las columnas se pueden reordenar arrastrando el control de puntos y contraer o expandir desde el encabezado.
