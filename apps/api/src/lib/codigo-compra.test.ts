import { describe, expect, it } from "bun:test";
import { generarCodigoCompra, type ClienteConVentas } from "./codigo-compra";

function clienteQueSiempreDice(existe: boolean): ClienteConVentas {
  return {
    venta: {
      findUnique: async () => (existe ? { id: "venta-existente" } : null),
    },
  };
}

describe("generarCodigoCompra", () => {
  it("genera un código con el prefijo y 6 dígitos", async () => {
    const codigo = await generarCodigoCompra(
      clienteQueSiempreDice(false),
      "empresa-1",
      "DIS",
    );
    expect(codigo).toMatch(/^DIS\d{6}$/);
  });

  it("reintenta si el código colisiona y devuelve el siguiente libre", async () => {
    let llamadas = 0;
    const tx: ClienteConVentas = {
      venta: {
        findUnique: async () => {
          llamadas += 1;
          // Las primeras dos colisionan, la tercera está libre.
          return llamadas <= 2 ? { id: "colision" } : null;
        },
      },
    };

    const codigo = await generarCodigoCompra(tx, "empresa-1", "DIS");
    expect(codigo).toMatch(/^DIS\d{6}$/);
    expect(llamadas).toBe(3);
  });

  it("lanza error tras agotar 5 intentos sin devolver un código duplicado", async () => {
    let llamadas = 0;
    const tx: ClienteConVentas = {
      venta: {
        findUnique: async () => {
          llamadas += 1;
          return { id: "siempre-colisiona" };
        },
      },
    };

    await expect(
      generarCodigoCompra(tx, "empresa-1", "DIS"),
    ).rejects.toThrow();
    expect(llamadas).toBe(5);
  });
});
