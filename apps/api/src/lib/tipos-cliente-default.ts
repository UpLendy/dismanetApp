// Toda empresa nueva arranca con estos tres tipos de cliente: sin al menos
// uno, el catálogo de precios no tiene nada contra qué vender (Precio exige
// tipoClienteId). El admin los renombra o desactiva después; el valor
// inicial es este. Compartido entre el seed (DISMANET) y el alta de empresa
// desde la API, para que las dos listas no se desalineen con el tiempo.
export const TIPOS_CLIENTE_POR_DEFECTO = ["Cliente normal", "Revendedor", "Promoción"] as const;
