---
'@coongro/ai-copilot': patch
---

El techo de prompt por llamada sube de 80.000 a 150.000 caracteres

No es un límite del modelo —admite bastante más— sino un tope de gasto por
llamada. Lo movió un caso concreto: el agente ciego le pasa al modelo el
catálogo publicado del kit entero para ver si alguien que no lo construyó puede
usarlo. Son 86 capabilities, unos 70.000 caracteres solo en definiciones, y con
lo que el runtime le agrega a cada una —el `confirmationToken` de las
escrituras, la paginación de las colecciones— quedaba apenas por encima del
tope. La prueba de nivel 5 no fallaba: no llegaba a arrancar.

El margen faltante era del orden del 10%, no del doble. Se sube a 150.000 para
que un kit completo entre con lugar de sobra, sabiendo que es el techo de TODAS
las llamadas del copiloto y no solo el de esta prueba.
