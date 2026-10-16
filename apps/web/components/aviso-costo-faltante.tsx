import Link from "next/link";
import { Aviso } from "@/components/ui/aviso";
import { AVISO_COSTO_FALTANTE_TITULO, type CostosFaltantes } from "@/lib/costo-cero";

// Misma redacción en /panel y en /ventas (punto 5, camino del dinero):
// centralizado en un solo componente para que no se desincronicen.
function AvisoCostoFaltante({ datos }: { datos: CostosFaltantes | null }) {
  if (!datos) return null;
  const { combinacionesSinCosto, paquetesSinCostoCompleto } = datos;
  if (combinacionesSinCosto === 0 && paquetesSinCostoCompleto === 0) return null;

  return (
    <Aviso
      variante="aviso"
      titulo={AVISO_COSTO_FALTANTE_TITULO}
      accion={
        <Link href="/panel/precios" className="text-sm font-medium underline">
          Ir a la matriz de precios
        </Link>
      }
    >
      <p>
        {combinacionesSinCosto > 0
          ? `${combinacionesSinCosto} combinación(es) de plataforma y duración no tienen costo registrado. `
          : null}
        {paquetesSinCostoCompleto > 0
          ? `${paquetesSinCostoCompleto} renglón(es) de paquete tienen componentes sin costo completo. `
          : null}
        La utilidad mostrada en esos casos no es real.
      </p>
    </Aviso>
  );
}

export { AvisoCostoFaltante };
