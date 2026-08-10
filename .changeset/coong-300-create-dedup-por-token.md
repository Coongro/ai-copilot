---
'@coongro/ai-copilot': patch
---

Dos altas iguales dejan de fusionarse en silencio: la identidad de un pedido es su confirmación, no sus datos

Un alta que repetía exactamente los argumentos de otra reciente devolvía el registro
de la anterior —con 200, sin error y sin ejecutar nada—, así que la segunda
desaparecía sin que nadie se enterara. La causa era la idempotencia de escrituras,
que deduplicaba por el hash de los argumentos: correcto para un reintento de
transporte, equivocado para un alta, porque crear dos «Cochera» o dos homónimos es
legítimo y no hay nada en los datos que distinga una intención de la otra. El efecto
aparecía en cualquier create publicado (unidades, contactos, órdenes de trabajo)
porque el punto está en la capa MCP, no en los plugins.

Ahora la identidad del pedido es el token de confirmación, que ya es único por
llamada: dos altas confirmadas por separado se ejecutan las dos. La protección
contra duplicados no se pierde — un reintento con el MISMO token devuelve el
resultado que ya se ejecutó, y si llega mientras la primera sigue corriendo se
responde que está en curso en vez de ejecutarla de nuevo. Una ejecución que falla o
que corta libera el token, así el mismo pedido se puede reintentar sin volver a
confirmar y sin quedar trabado.

La dedup por argumentos queda solo para escrituras que no exigen confirmación —hoy
ninguna publicada—, donde sin token no hay otra identidad posible.
