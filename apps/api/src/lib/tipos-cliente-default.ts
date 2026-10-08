// Toda empresa nueva arranca con estos tipos de cliente: sin al menos uno, el
// catálogo de precios no tiene nada contra qué vender (Precio exige
// tipoClienteId). El admin los renombra o desactiva después; el valor inicial
// es este. Compartido entre el seed (DISMANET), el alta de empresa desde la
// API y backfill-catalogo-base.ts, para que las listas no se desalineen.
//
// "Promoción" SE QUITÓ de esta lista a propósito. Era cómo se expresaban los
// precios promocionales antes de que `esPromocion` existiera como bandera de
// Paquete/Venta. La migración 20261007175656 lo desactivó en las empresas que
// ya existían; si siguiera aquí, cada empresa nueva —y cada corrida del
// backfill— lo volvería a crear activo, y el vendedor vería "Promoción" en
// dos lugares con dos significados distintos. No agregarlo de vuelta.
export const TIPOS_CLIENTE_POR_DEFECTO = ["Cliente normal", "Revendedor"] as const;
