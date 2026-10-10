import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Hallazgo 8: vender() deja el error en pantalla y luego llama a
// cargarOpciones() para refrescar cupos. cargarOpciones() tiene prohibido
// limpiar `error` (ver el comentario en page.tsx) precisamente para que ese
// refresco no borre el mensaje en silencio. Estas pruebas no se conforman
// con ver el 409 del servidor: montan el componente real, fuerzan la venta
// a fallar, y verifican que el texto siga visible después de que el
// refresco posterior (con su propio llamado a la API) haya terminado.

const mockSaldoGet = mock(() => Promise.resolve<any>({}));
const mockTiposClienteGet = mock(() => Promise.resolve<any>({}));
const mockDuracionesGet = mock(() => Promise.resolve<any>({}));
const mockPlataformasGet = mock(() => Promise.resolve<any>({}));
const mockPaquetesGet = mock(() => Promise.resolve<any>({}));
const mockVentasPost = mock(() => Promise.resolve<any>({}));

mock.module("@/lib/api", () => ({
  api: {
    perfil: { saldo: { get: mockSaldoGet } },
    ventas: {
      "tipos-cliente": { get: mockTiposClienteGet },
      duraciones: { get: mockDuracionesGet },
      plataformas: { get: mockPlataformasGet },
      paquetes: { get: mockPaquetesGet },
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
        { id: "p1", nombre: "Netflix", condiciones: null, pantallasLibres: 3, precioVenta: "10000" },
      ],
    },
    error: null,
  });
  mockPaquetesGet.mockReset().mockResolvedValue({ data: { paquetes: [] }, error: null });
  mockVentasPost.mockReset();
});

afterEach(() => {
  cleanup();
});

// Deja el formulario listo para vender: tipo de cliente, duración y
// producto elegidos. Cada combinación dispara cargarOpciones(), así que hay
// que esperar a que la lista de productos llegue antes de elegir uno.
async function completarFormulario() {
  render(<PaginaVender />);

  const selectTipoCliente = await screen.findByLabelText("Tipo de cliente");
  fireEvent.change(selectTipoCliente, { target: { value: "tc1" } });

  const selectDuracion = screen.getByLabelText("Duración");
  fireEvent.change(selectDuracion, { target: { value: "d1" } });

  const selectProducto = screen.getByLabelText("Producto");
  await waitFor(() => expect(mockPlataformasGet).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(selectProducto.querySelector('option[value="p1"]')).toBeTruthy());
  fireEvent.change(selectProducto, { target: { value: "p1" } });

  const botonVender = screen.getByRole("button", { name: "Vender" }) as HTMLButtonElement;
  await waitFor(() => expect(botonVender.disabled).toBe(false));
  return botonVender;
}

describe("vender() — el error sobrevive al refresco posterior", () => {
  test("saldo insuficiente queda visible después de refrescar cupos", async () => {
    const mensaje = "Esta venta cuesta $10.000. Tu saldo es $5.000, te faltan $5.000.";
    mockVentasPost.mockResolvedValueOnce({
      data: null,
      error: { value: { error: { codigo: "SALDO_INSUFICIENTE", mensaje } } },
    });

    const botonVender = await completarFormulario();
    fireEvent.click(botonVender);

    await waitFor(() => expect(screen.getByText(mensaje)).toBeTruthy());

    // vender() refresca cupos tras el fallo (segundo llamado a plataformas).
    // El mensaje debe seguir ahí una vez ese refresco termina.
    await waitFor(() => expect(mockPlataformasGet).toHaveBeenCalledTimes(2));
    expect(screen.getByText(mensaje)).toBeTruthy();
  });

  test("inventario insuficiente queda visible después de refrescar cupos", async () => {
    const mensaje = "No hay suficientes pantallas libres de Netflix.";
    mockVentasPost.mockResolvedValueOnce({
      data: null,
      error: { value: { error: { codigo: "INVENTARIO_INSUFICIENTE", mensaje } } },
    });

    const botonVender = await completarFormulario();
    fireEvent.click(botonVender);

    await waitFor(() => expect(screen.getByText(mensaje)).toBeTruthy());
    await waitFor(() => expect(mockPlataformasGet).toHaveBeenCalledTimes(2));
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
