---
'@coongro/ai-copilot': patch
---

Una capacidad que devuelve el id de otro recurso ya puede decirlo

La referencia que se le entrega al agente salía del prefijo de la acción, así que una operación que
vive bajo un recurso y devuelve el identificador de otro —guardar el inquilino de un contrato
devuelve un contacto— la etiquetaba mal, y el paso siguiente la rechazaba por ser de otro recurso.
Ahora, si el catálogo declara a qué recurso pertenece lo que devuelve, se respeta.
