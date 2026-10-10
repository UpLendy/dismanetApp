import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Hallazgo 8: vender() deja el error en pantalla y luego llama a
// cargarOpciones() para refrescar las combinaciones de precio del ítem ya
// elegido (ya no refresca la grilla completa: esa se carga una sola vez al
// montar la pantalla). cargarOpciones() tiene prohibido limpiar `error` (ver
// el comentario en page.tsx) precisamente para que ese refresco no borre el
// mensaje en silencio. Estas pruebas no se conforman con ver el 409 del
// servidor: montan el componente real, fuerzan la venta a fallar, y
// verifican que el texto siga visible después de que el refresco posterior
// (con su propio llamado a la API) haya terminado.

const mockSaldoGet = mock(() => Promise.resolve<any>({}));
const mockTiposClienteGet = mock(() => Promise.resolve<any>({}));
const mockDuracionesGet = mock(() => Promise.resolve<any>({}));
const mockPlataformasGet = mock(() => Promise.resolve<any>({}));
const mockPaquetesGet = mock(() => Promise.resolve<any>({}));
const mockOpcionesPlataformaGet = mock((_params?: { id: string }) => Promise.resolve<any>({}));
const mockVentasPost = mock(() => Promise.resolve<any>({}));

// api.ventas.plataformas es tanto una función invocable con { id } (el path
// param de Eden Treaty para /plataformas/:id/opciones) como un objeto con
// .get (para /plataformas sin parámetros, el grid del paso 2). Mismo truco
// para paquetes.
function plataformasApi(params?: { id: string }) {
  return { opciones: { get: () => mockOpcionesPlataformaGet(params) } };
}
plataformasApi.get = mockPlataformasGet;

function paquetesApi() {
  return { opciones: { get: () => Promise.resolve<any>({ data: { opciones: [] } }) } };
}
paquetesApi.get = mockPaquetesGet;

mock.module("@/lib/api", () => ({
  api: {
    perfil: { saldo: { get: mockSaldoGet } },
    ventas: {
      "tipos-cliente": { get: mockTiposClienteGet },
      duraciones: { get: mockDuracionesGet },
      plataformas: plataformasApi,
      paquetes: paquetesApi,
      post: mockVentasPost,
    },
  },
}));

const { default: PaginaVender } = await import("./page");

beforeEach(() => {
  mockSaldoGet.mockReset().mockResolvedValue({ data: { usaSaldo: false, saldo: null }, error: null });
  mockTiposClienteGet
    .mockReset()
    .mockResolvedValue({ data: { tiposCliente: [{ id: "tc1", nombre: "Normal" }] }, error: null });
  mockDuracionesGet
    .mockReset()
    .mockResolvedValue({ data: { duraciones: [{ id: "d1", nombre: "1 mes", cantidad: 1, unidad: "MESES" }] }, error: null });
  mockPlataformasGet.mockReset().mockResolvedValue({
    data: {
      plataformas: [
        { id: "p1", nombre: "Netflix", condiciones: null, logoUrl: null, pantallasLibres: 3, tienePrecio: true },
      ],
    },
    error: null,
  });
  mockPaquetesGet.mockReset().mockResolvedValue({ data: { paquetes: [] }, error: null });
  mockOpcionesPlataformaGet
    .mockReset()
    .mockResolvedValue({ data: { opciones: [{ duracionId: "d1", tipoClienteId: "tc1", precioVenta: "10000" }] }, error: null });
  mockVentasPost.mockReset();
});

afterEach(() => {
  cleanup();
});

// Deja el formulario listo para vender: pastilla UNIDAD → plataforma en el
// modal → tipo de cliente y duración. Elegir la plataforma dispara
// cargarOpciones(), así que hay que esperar a que esa llamada resuelva
// antes de tocar los selectores del paso 3.
async function completarFormulario() {
  render(<PaginaVender />);

  const pildoraUnidad = await screen.findByRole("button", { name: /Unidad/ });
  fireEvent.click(pildoraUnidad);

  const tarjetaPlataforma = await screen.findByRole("button", { name: /Netflix/ });
  fireEvent.click(tarjetaPlataforma);

  await waitFor(() => expect(mockOpcionesPlataformaGet).toHaveBeenCalledTimes(1));

  const selectTipoCliente = await screen.findByLabelText("Tipo de cliente");
  fireEvent.change(selectTipoCliente, { target: { value: "tc1" } });

  const selectDuracion = screen.getByLabelText("Duración");
  fireEvent.change(selectDuracion, { target: { value: "d1" } });

  const botonVender = screen.getByRole("button", { name: "Vender" }) as HTMLButtonElement;
  await waitFor(() => expect(botonVender.disabled).toBe(false));
  return botonVender;
}

describe("vender() — el error sobrevive al refresco posterior", () => {
  test("saldo insuficiente queda visible después de refrescar las combinaciones de precio", async () => {
    const mensaje = "Esta venta cuesta $10.000. Tu saldo es $5.000, te faltan $5.000.";
    mockVentasPost.mockResolvedValueOnce({
      data: null,
      error: { value: { error: { codigo: "SALDO_INSUFICIENTE", mensaje } } },
    });

    const botonVender = await completarFormulario();
    fireEvent.click(botonVender);

    await waitFor(() => expect(screen.getByText(mensaje)).toBeTruthy());

    // vender() refresca /opciones tras el fallo (segundo llamado). El
    // mensaje debe seguir ahí una vez ese refresco termina.
    await waitFor(() => expect(mockOpcionesPlataformaGet).toHaveBeenCalledTimes(2));
    expect(screen.getByText(mensaje)).toBeTruthy();
  });

  test("inventario insuficiente queda visible después de refrescar las combinaciones de precio", async () => {
    const mensaje = "No hay suficientes pantallas libres de Netflix.";
    mockVentasPost.mockResolvedValueOnce({
      data: null,
      error: { value: { error: { codigo: "INVENTARIO_INSUFICIENTE", mensaje } } },
    });

    const botonVender = await completarFormulario();
    fireEvent.click(botonVender);

    await waitFor(() => expect(screen.getByText(mensaje)).toBeTruthy());
    await waitFor(() => expect(mockOpcionesPlataformaGet).toHaveBeenCalledTimes(2));
    expect(screen.getByText(mensaje)).toBeTruthy();
  });
});

describe("vender() — aviso de plantilla no configurada", () => {
  test("el aviso ya no se descarta: queda visible en la pantalla de venta registrada", async () => {
    const mensajeAviso =
      "Esta empresa no tiene configurado el mensaje de venta; se usó un mensaje de respaldo. Pide al administrador que lo configure.";
    mockVentasPost.mockResolvedValueOnce({
      data: {
        venta: {
          id: "v1",
          codigoCompra: "ABC123",
          tipoVenta: "UNIDAD",
          nombreItem: "Netflix",
          nombreDuracion: "1 mes",
          nombreTipoCliente: "Normal",
          precioVenta: "10000",
          celularCliente: null,
          fechaVenta: new Date().toISOString(),
          fechaVencimientoMax: new Date().toISOString(),
          mensajeGenerado: "mensaje de respaldo genérico",
          esPromocion: false,
        },
        aviso: { codigo: "PLANTILLA_NO_CONFIGURADA", mensaje: mensajeAviso },
      },
      error: null,
    });

    const botonVender = await completarFormulario();
    fireEvent.click(botonVender);

    await screen.findByText("Venta registrada");
    expect(screen.getByText(mensajeAviso)).toBeTruthy();
  });

  test("una venta sin aviso no muestra ningún banner de plantilla", async () => {
    mockVentasPost.mockResolvedValueOnce({
      data: {
        venta: {
          id: "v2",
          codigoCompra: "XYZ789",
          tipoVenta: "UNIDAD",
          nombreItem: "Netflix",
          nombreDuracion: "1 mes",
          nombreTipoCliente: "Normal",
          precioVenta: "10000",
          celularCliente: null,
          fechaVenta: new Date().toISOString(),
          fechaVencimientoMax: new Date().toISOString(),
          mensajeGenerado: "mensaje normal",
          esPromocion: false,
        },
      },
      error: null,
    });

    const botonVender = await completarFormulario();
    fireEvent.click(botonVender);

    await screen.findByText("Venta registrada");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
