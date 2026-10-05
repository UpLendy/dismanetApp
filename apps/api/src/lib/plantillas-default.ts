// Texto exacto del Anexo B del PRD (B.1 y B.2). Toda empresa nueva arranca
// con estas dos plantillas (una empresa sin PlantillaMensaje no podría
// vender nada, porque realizarVenta no tiene mensaje que generar) — el
// ADMIN podrá editarlas más adelante, pero el valor inicial es este.
export const PLANTILLA_UNIDAD_POR_DEFECTO = `♥️ *{{plataforma}} ({{duracion}})* ♥️

*fecha*
{{fechaEnLetras}}

*CODIGO DE COMPRA*
{{codigoCompra}}

*PERFIL:*
{{perfil}}

*PIN:*
{{pin}}

*CORREO:*
{{correo}}

*CONTRASEÑA:*
{{clave}}

*POLITICAS DE USO* 🫵
❌*NO* cambiar nombres
❌*NO* cambiar pines
❌*NO* usar más de 1 dispositivo

*IMPORTANTE* tenemos segundo numero para soporte

*INSTAGRAM* 👇
https://www.instagram.com/dismanet.col

*¿Quieres un perfume?*
*disma perfumes* te lo tiene
*catalogo:* https://vercatalogo.com/dismanet/products`;

export const PLANTILLA_PAQUETE_POR_DEFECTO = `♥️ *{{paquete}} ({{duracion}})* ♥️

*fecha*
{{fechaEnLetras}}

*CODIGO DE COMPRA*
{{codigoCompra}}

{{listaCuentas}}

*POLITICAS DE USO* 🫵
❌*NO* cambiar nombres
❌*NO* cambiar pines
❌*NO* usar más de 1 dispositivo

*IMPORTANTE* tenemos segundo numero para soporte

*INSTAGRAM* 👇
https://www.instagram.com/dismanet.col

*¿Quieres un perfume?*
*disma perfumes* te lo tiene
*catalogo:* https://vercatalogo.com/dismanet/products`;

// Plantillas de RESPALDO — nunca se guardan en PlantillaMensaje, viven solo
// en código. realizarVenta() las usa cuando la empresa no tiene una
// PlantillaMensaje configurada para el tipo que se está vendiendo: la venta
// se completa igual (una venta no se pierde por un problema de formato) con
// un texto sobrio y funcional, sin la marca de DISMANET. El resultado trae
// un aviso para que el admin sepa que debe configurar la suya en
// (admin)/panel/mensajes.
export const PLANTILLA_RESPALDO_UNIDAD = `*{{plataforma}} — {{duracion}}*

Código de compra: {{codigoCompra}}
Fecha: {{fecha}}
Vence: {{fechaVencimiento}}

Perfil: {{perfil}}
PIN: {{pin}}

Correo: {{correo}}
Contraseña: {{clave}}`;

export const PLANTILLA_RESPALDO_PAQUETE = `*{{paquete}} — {{duracion}}*

Código de compra: {{codigoCompra}}
Fecha: {{fecha}}
Vence: {{fechaVencimiento}}

{{listaCuentas}}`;
