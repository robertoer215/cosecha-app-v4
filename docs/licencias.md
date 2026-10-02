# Licencias de las fuentes de datos

Este documento registra el origen y la licencia de cada fuente de datos usada en COSECHA. Ningún dato proviene de bases propietarias (MyFitnessPal, Fitia, FatSecret, WHOOP).

## free-exercise-db

- **Fuente:** https://github.com/yuhonas/free-exercise-db
- **Licencia:** Unlicense (dominio público). Permite usar, copiar, modificar y distribuir sin restricciones ni atribución obligatoria.
- **Uso en COSECHA:** base de ejercicios (`data/ejercicios.json`, 876 ejercicios). Los nombres, músculos, equipo, nivel, categoría e instrucciones provienen del dataset original; los campos en español son traducción propia del contenido original en inglés (`nombreEn` conserva el nombre original).
- **Imágenes:** se sirven bajo demanda desde su CDN público (`raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<ruta>`). **No se incluyen en este repositorio**; el campo `imagenes` guarda solo la ruta relativa dentro del dataset.

## USDA FoodData Central

- **Fuente:** https://fdc.nal.usda.gov/ (U.S. Department of Agriculture, Agricultural Research Service)
- **Licencia:** CC0 1.0 (dominio público). La atribución no es obligatoria pero sí recomendada por el USDA.
- **Atribución recomendada:** U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov
- **Uso en COSECHA:** valores nutricionales de la base de alimentos. Cada valor se copia textual (verbatim) del registro de FDC correspondiente; cuando un nutriente no existe en la fuente, el campo queda vacío y declarado como tal, nunca estimado.

## Carta COSECHA

- **Fuente:** elaboración propia (recetario y carta del restaurante COSECHA).
- **Licencia:** material propio del proyecto; todos los derechos reservados a COSECHA.
- **Uso en COSECHA:** platillos, porciones y composición de la carta. Los valores nutricionales derivados se calculan a partir de ingredientes con datos de USDA FoodData Central (CC0).

## Software de terceros en la app

- **qrcodejs 1.0.0** (davidshimjs) — generación del QR del resumen, cargado
  desde cdnjs. Licencia MIT.
