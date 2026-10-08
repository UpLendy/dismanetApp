import { describe, expect, it } from "bun:test";
import {
  formatearPesos,
  renderizarMensajePaquete,
  renderizarMensajeUnidad,
  type DatosMensajePaquete,
  type DatosMensajeUnidad,
} from "./mensaje.ts";

// Texto exacto del Anexo B del PRD (B.1 y B.2).
const PLANTILLA_UNIDAD = `♥️ *{{plataforma}} ({{duracion}})* ♥️

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

const PLANTILLA_PAQUETE = `♥️ *{{paquete}} ({{duracion}})* ♥️

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

describe("formatearPesos", () => {
  it("formatea un Decimal/string/number como pesos colombianos sin decimales", () => {
    expect(formatearPesos(15000)).toContain("15.000");
    expect(formatearPesos("15000")).toContain("15.000");
  });
});

describe("renderizarMensajeUnidad (f) — contiene código, fecha en letras, perfil, PIN, correo y contraseña", () => {
  const datos: DatosMensajeUnidad = {
    codigoCompra: "DIS995865",
    // 2026-09-27T15:00:00Z -> 2026-09-27 10:00 America/Bogota (UTC-5): mismo día.
    fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
    nombreTipoCliente: "Nuevo",
    nombreDuracion: "30 días",
    fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
    precioVenta: "15000",
    nombrePlataformaMensaje: "N.E.T.F.L.I.X",
    perfil: "E",
    pin: "5010",
    correo: "geradooopaltaa32@hotmail.com",
    clave: "Net8123@",
  };

  const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD, datos);

  it("sustituye {{plataforma}} y {{duracion}} en el encabezado", () => {
    expect(mensaje).toContain("♥️ *N.E.T.F.L.I.X (30 días)* ♥️");
  });

  it("sustituye {{fechaEnLetras}} con el día en hora de Bogotá", () => {
    expect(mensaje).toContain("Veintisiete de septiembre");
  });

  it("sustituye {{codigoCompra}}", () => {
    expect(mensaje).toContain("DIS995865");
  });

  it("sustituye {{perfil}} y {{pin}}", () => {
    expect(mensaje).toContain("*PERFIL:*\nE");
    expect(mensaje).toContain("*PIN:*\n5010");
  });

  it("sustituye {{correo}} y {{clave}}", () => {
    expect(mensaje).toContain("*CORREO:*\ngeradooopaltaa32@hotmail.com");
    expect(mensaje).toContain("*CONTRASEÑA:*\nNet8123@");
  });

  it("no deja ningún marcador {{...}} sin sustituir", () => {
    expect(mensaje).not.toMatch(/\{\{\w+\}\}/);
  });

  it("conserva el texto fijo de políticas de uso", () => {
    expect(mensaje).toContain("❌*NO* cambiar nombres");
    expect(mensaje).toContain("https://www.instagram.com/dismanet.col");
  });
});

describe("{{celular}} — venta sin celularCliente", () => {
  const datosSinCelular: DatosMensajeUnidad = {
    codigoCompra: "DIS995865",
    fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
    nombreTipoCliente: "Nuevo",
    nombreDuracion: "30 días",
    fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
    precioVenta: "15000",
    nombrePlataformaMensaje: "N.E.T.F.L.I.X",
    perfil: "E",
    pin: "5010",
    correo: "geradooopaltaa32@hotmail.com",
    clave: "Net8123@",
    celularCliente: null,
  };

  const mensaje = renderizarMensajeUnidad("Código: {{codigoCompra}} · Celular: {{celular}}.", datosSinCelular);

  it("el marcador se resuelve vacío: ni 'undefined' ni el marcador literal", () => {
    expect(mensaje).toBe("Código: DIS995865 · Celular: .");
    expect(mensaje).not.toContain("undefined");
    expect(mensaje).not.toContain("{{celular}}");
  });

  it("con celularCliente presente, sustituye el número", () => {
    const conCelular = renderizarMensajeUnidad("Celular: {{celular}}", { ...datosSinCelular, celularCliente: "3001234567" });
    expect(conCelular).toBe("Celular: 3001234567");
  });
});

describe("renderizarMensajePaquete (g) — un bloque por plataforma, con su duración real, omitiendo PERFIL/PIN cuando no aplica", () => {
  const datos: DatosMensajePaquete = {
    codigoCompra: "DIS123456",
    fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
    nombreTipoCliente: "Nuevo",
    nombreDuracion: "30 días",
    fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
    precioVenta: "25000",
    nombrePaquete: "Básico 1",
    componentes: [
      {
        nombrePlataforma: "N.E.T.F.L.I.X",
        usaPerfilPin: true,
        nombreDuracionReal: "28 días",
        perfil: "A",
        pin: "1234",
        correo: "netflix@dismanet.test",
        clave: "Net8123@",
      },
      {
        nombrePlataforma: "Disney+ Premium",
        usaPerfilPin: true,
        nombreDuracionReal: "30 días",
        perfil: "B",
        pin: "5678",
        correo: "disney@dismanet.test",
        clave: "Dis8123@",
      },
      {
        nombrePlataforma: "Spotify",
        usaPerfilPin: false,
        nombreDuracionReal: "30 días",
        perfil: null,
        pin: null,
        correo: "spotify@dismanet.test",
        clave: "Spo8123@",
      },
    ],
  };

  const mensaje = renderizarMensajePaquete(PLANTILLA_PAQUETE, datos);

  it("sustituye {{paquete}} y {{duracion}} en el encabezado", () => {
    expect(mensaje).toContain("♥️ *Básico 1 (30 días)* ♥️");
  });

  it("incluye un bloque por plataforma, con SU duración real", () => {
    expect(mensaje).toContain("*N.E.T.F.L.I.X (28 días)*");
    expect(mensaje).toContain("*Disney+ Premium (30 días)*");
    expect(mensaje).toContain("*Spotify (30 días)*");
  });

  it("incluye PERFIL y PIN para las plataformas que sí usan perfil/pin", () => {
    expect(mensaje).toContain("*PERFIL:* A");
    expect(mensaje).toContain("*PIN:* 1234");
    expect(mensaje).toContain("*PERFIL:* B");
    expect(mensaje).toContain("*PIN:* 5678");
  });

  it("omite las líneas PERFIL/PIN para la plataforma que NO usa perfil/pin (Spotify)", () => {
    const bloqueSpotify = mensaje.split("\n\n").find((bloque) => bloque.includes("Spotify"));
    expect(bloqueSpotify).toBeDefined();
    expect(bloqueSpotify).not.toContain("PERFIL");
    expect(bloqueSpotify).not.toContain("PIN");
    expect(bloqueSpotify).toContain("*CORREO:* spotify@dismanet.test");
    expect(bloqueSpotify).toContain("*CONTRASEÑA:* Spo8123@");
  });

  it("no deja ningún marcador {{...}} sin sustituir", () => {
    expect(mensaje).not.toMatch(/\{\{\w+\}\}/);
  });
});
