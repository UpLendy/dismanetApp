import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";

// F4.6 — Vender navega aquí con codigoCompra/correoCuenta o garantiaExterna=1
// en la URL (ver vender/page.tsx). Estas pruebas cubren el lado que recibe
// esa navegación: el filtro debe llegar ya aplicado, y el diálogo de
// garantía externa debe abrirse solo una vez, nunca de nuevo en un
// render posterior (p. ej. al cerrarlo).

const mockPantallasGet = mock(() => Promise.resolve<any>({}));
const mockCatalogoExternaGet = mock(() => Promise.resolve<any>({}));
const mockCostoExternoGet = mock(() => Promise.resolve<any>({}));

mock.module("@/lib/api", () => ({
  api: {
    garantias: Object.assign(() => ({ reemplazar: { post: mock(() => Promise.resolve<any>({})) } }), {
      "pantallas-vendidas": { get: mockPantallasGet },
      "catalogo-externa": { get: mockCatalogoExternaGet },
      "costo-externo": { get: mockCostoExternoGet },
      externa: { post: mock(() => Promise.resolve<any>({})) },
    }),
  },
}));

// mock.module("next/navigation", ...) reemplaza el módulo para TODO el
// proceso de bun test — si vender/page.test.tsx corre en la misma tanda y
// registra su propio mock sin esta exportación, cualquiera de los dos que
// quede activo debe seguir sirviendo lo que el otro necesita. Por eso
// incluye también useRouter, aunque este archivo no lo use.
let mockSearchParamsValue = new URLSearchParams();
mock.module("next/navigation", () => ({
  useSearchParams: () => mockSearchParamsValue,
  useRouter: () => ({ push: () => {} }),
}));

const { PantallasVendidasContenido } = await import("./pantallas-vendidas-contenido");

beforeEach(() => {
  mockSearchParamsValue = new URLSearchParams();
  mockPantallasGet.mockReset().mockResolvedValue({ data: { pantallas: [] }, error: null });
  mockCatalogoExternaGet.mockReset().mockResolvedValue({ data: { plataformas: [], duraciones: [] }, error: null });
  mockCostoExternoGet.mockReset().mockResolvedValue({ data: { costoAsumido: "0" }, error: null });
});

afterEach(() => {
  cleanup();
});

describe("Garantía — hidratación de filtros desde la URL (F4.6)", () => {
  test("codigoCompra en la URL llega aplicado al filtro y a la petición inicial", async () => {
    mockSearchParamsValue = new URLSearchParams("codigoCompra=DIS995865");

    render(<PantallasVendidasContenido rol="ADMIN" />);

    await waitFor(() => expect(mockPantallasGet).toHaveBeenCalledTimes(1));
    expect(mockPantallasGet).toHaveBeenCalledWith({ query: { codigoCompra: "DIS995865" } });

    const input = await screen.findByLabelText("Código de compra");
    expect((input as HTMLInputElement).value).toBe("DIS995865");
  });

  test("correoCuenta en la URL llega aplicado al filtro y a la petición inicial", async () => {
    mockSearchParamsValue = new URLSearchParams("correoCuenta=cuenta%40correo.com");

    render(<PantallasVendidasContenido rol="ADMIN" />);

    await waitFor(() => expect(mockPantallasGet).toHaveBeenCalledTimes(1));
    expect(mockPantallasGet).toHaveBeenCalledWith({ query: { correoCuenta: "cuenta@correo.com" } });

    const input = await screen.findByLabelText("Correo de la cuenta");
    expect((input as HTMLInputElement).value).toBe("cuenta@correo.com");
  });

  test("sin parámetros en la URL, la petición inicial sigue sin filtros", async () => {
    render(<PantallasVendidasContenido rol="ADMIN" />);

    await waitFor(() => expect(mockPantallasGet).toHaveBeenCalledTimes(1));
    expect(mockPantallasGet).toHaveBeenCalledWith({ query: {} });
  });
});

describe("Garantía externa — disparo único desde la URL (F4.6)", () => {
  test("garantiaExterna=1 abre el diálogo una sola vez; cerrarlo no lo reabre", async () => {
    mockSearchParamsValue = new URLSearchParams("garantiaExterna=1");

    render(<PantallasVendidasContenido rol="ADMIN" />);

    await screen.findByRole("alertdialog");
    expect(mockCatalogoExternaGet).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    // Forzar un re-render (p. ej. limpiar filtros) no debe reabrir el
    // diálogo: el efecto que lo dispara corre solo al montar.
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    await waitFor(() => expect(mockPantallasGet).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("sin garantiaExterna en la URL, el diálogo no se abre solo", async () => {
    render(<PantallasVendidasContenido rol="ADMIN" />);

    await waitFor(() => expect(mockPantallasGet).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mockCatalogoExternaGet).not.toHaveBeenCalled();
  });
});

// F4.7, arreglo 2 — /garantias/costo-externo es ADMIN-only (R4): un EMPLEADO
// no debe ni pedir ese costo ni verlo en el diálogo de garantía externa.
describe("Garantía externa — pérdida visible solo para ADMIN (F4.7)", () => {
  test("EMPLEADO: no pide /costo-externo y el diálogo no menciona la pérdida", async () => {
    mockSearchParamsValue = new URLSearchParams("garantiaExterna=1");
    mockCatalogoExternaGet.mockResolvedValue({
      data: {
        plataformas: [{ id: "p1", nombre: "Netflix", condiciones: null, pantallasLibres: 3 }],
        duraciones: [{ id: "d1", nombre: "30 días", cantidad: 30, unidad: "DIAS" }],
      },
      error: null,
    });

    render(<PantallasVendidasContenido rol="EMPLEADO" />);

    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialogo).getByLabelText("Plataforma"), { target: { value: "p1" } });
    fireEvent.change(within(dialogo).getByLabelText("Duración"), { target: { value: "d1" } });
    fireEvent.change(within(dialogo).getByLabelText("Fecha de vencimiento"), { target: { value: "2026-12-31" } });

    await waitFor(() => expect(dialogo.textContent).toContain("ocupada hasta"));
    expect(dialogo.textContent).not.toContain("pérdida");
    expect(mockCostoExternoGet).not.toHaveBeenCalled();
  });

  test("ADMIN: sí pide /costo-externo y el diálogo menciona la pérdida", async () => {
    mockSearchParamsValue = new URLSearchParams("garantiaExterna=1");
    mockCatalogoExternaGet.mockResolvedValue({
      data: {
        plataformas: [{ id: "p1", nombre: "Netflix", condiciones: null, pantallasLibres: 3 }],
        duraciones: [{ id: "d1", nombre: "30 días", cantidad: 30, unidad: "DIAS" }],
      },
      error: null,
    });

    render(<PantallasVendidasContenido rol="ADMIN" />);

    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialogo).getByLabelText("Plataforma"), { target: { value: "p1" } });
    fireEvent.change(within(dialogo).getByLabelText("Duración"), { target: { value: "d1" } });
    fireEvent.change(within(dialogo).getByLabelText("Fecha de vencimiento"), { target: { value: "2026-12-31" } });

    await waitFor(() => expect(mockCostoExternoGet).toHaveBeenCalled());
    await waitFor(() => expect(dialogo.textContent).toContain("pérdida"));
  });
});
