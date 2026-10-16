import { describe, expect, it } from "bun:test";
import { PLANTILLA_UNIDAD_POR_DEFECTO, PLANTILLA_RESPALDO_UNIDAD } from "./plantillas-default.ts";
import { renderizarMensajeUnidad } from "./mensaje.ts";

// F4.7, arreglo 3 — F4.2 agregó usuario/codigo/enlace a MARCADORES_UNIDAD
// pero nunca a las plantillas por defecto: una empresa sin PlantillaMensaje
// vendía una plataforma de usuario+código y el comprador no recibía ninguno
// de los dos datos con los que de verdad entra.
describe("plantillas por defecto incluyen los bloques de usuario/código/enlace (F4.7)", () => {
  it("PLANTILLA_UNIDAD_POR_DEFECTO declara los tres marcadores", () => {
    expect(PLANTILLA_UNIDAD_POR_DEFECTO).toContain("{{usuario}}");
    expect(PLANTILLA_UNIDAD_POR_DEFECTO).toContain("{{codigo}}");
    expect(PLANTILLA_UNIDAD_POR_DEFECTO).toContain("{{enlace}}");
  });

  it("PLANTILLA_RESPALDO_UNIDAD declara los tres marcadores", () => {
    expect(PLANTILLA_RESPALDO_UNIDAD).toContain("{{usuario}}");
    expect(PLANTILLA_RESPALDO_UNIDAD).toContain("{{codigo}}");
    expect(PLANTILLA_RESPALDO_UNIDAD).toContain("{{enlace}}");
  });

  const datosBase = {
    codigoCompra: "DIS123",
    fechaVenta: new Date("2026-01-15T12:00:00Z"),
    nombreTipoCliente: "Nuevo",
    nombreDuracion: "30 días",
    fechaVencimientoMax: new Date("2026-02-14T12:00:00Z"),
    precioVenta: "15000",
    celularCliente: null,
    ocultarPrecio: false,
    nombrePlataformaMensaje: "Disney+",
    perfil: "Perfil 1",
    pin: "1234",
    correo: null,
    usuario: "usuario-disney",
    codigo: "AB12CD",
    enlace: "https://disneyplus.com/activar",
    clave: "clave-secreta",
    usaPerfilPin: true,
    usaCorreo: false,
    usaUsuario: true,
    usaCodigo: true,
    usaEnlace: true,
  };

  it("una plataforma de usuario+código recibe ambos datos en el mensaje, no perfil/correo", () => {
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD_POR_DEFECTO, datosBase);
    expect(mensaje).toContain("usuario-disney");
    expect(mensaje).toContain("AB12CD");
    expect(mensaje).toContain("https://disneyplus.com/activar");
  });

  it("una plataforma que no usa usuario/código/enlace no deja esas etiquetas huérfanas", () => {
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD_POR_DEFECTO, {
      ...datosBase,
      usuario: null,
      codigo: null,
      enlace: null,
      usaUsuario: false,
      usaCodigo: false,
      usaEnlace: false,
      usaCorreo: true,
      correo: "cuenta@correo.com",
    });
    expect(mensaje).not.toContain("*USUARIO:*");
    expect(mensaje).not.toContain("*CÓDIGO:*");
    expect(mensaje).not.toContain("*ENLACE:*");
    expect(mensaje).toContain("cuenta@correo.com");
  });
});
