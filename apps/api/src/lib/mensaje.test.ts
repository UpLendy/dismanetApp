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
    usaPerfilPin: true,
    usaCorreo: true,
    usaUsuario: false,
    usaCodigo: false,
    usaEnlace: false,
    perfil: "E",
    pin: "5010",
    correo: "geradooopaltaa32@hotmail.com",
    usuario: null,
    codigo: null,
    enlace: null,
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
    usaPerfilPin: true,
    usaCorreo: true,
    usaUsuario: false,
    usaCodigo: false,
    usaEnlace: false,
    perfil: "E",
    pin: "5010",
    correo: "geradooopaltaa32@hotmail.com",
    usuario: null,
    codigo: null,
    enlace: null,
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

describe("renderizarMensajeUnidad — omite PERFIL/PIN cuando la plataforma no usa perfil/pin (h)", () => {
  const base: DatosMensajeUnidad = {
    codigoCompra: "DIS741852",
    fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
    nombreTipoCliente: "Nuevo",
    nombreDuracion: "1 mes",
    fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
    precioVenta: "12000",
    nombrePlataformaMensaje: "Spotify",
    usaPerfilPin: false,
    usaCorreo: true,
    usaUsuario: false,
    usaCodigo: false,
    usaEnlace: false,
    perfil: null,
    pin: null,
    correo: "spotify2@dismanet.test",
    usuario: null,
    codigo: null,
    enlace: null,
    clave: "Spo9999@",
  };

  it("sin perfil/pin: el mensaje no contiene 'PERFIL' ni 'PIN', pero sí correo y contraseña", () => {
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD, base);
    expect(mensaje).not.toContain("PERFIL");
    expect(mensaje).not.toContain("PIN");
    expect(mensaje).toContain("*CORREO:*\nspotify2@dismanet.test");
    expect(mensaje).toContain("*CONTRASEÑA:*\nSpo9999@");
    expect(mensaje).not.toMatch(/\{\{\w+\}\}/);
  });

  it("con perfil/pin: sí contiene las etiquetas con sus valores", () => {
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD, {
      ...base,
      usaPerfilPin: true,
      perfil: "C",
      pin: "9090",
    });
    expect(mensaje).toContain("*PERFIL:*\nC");
    expect(mensaje).toContain("*PIN:*\n9090");
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
        usaCorreo: true,
        usaUsuario: false,
        usaCodigo: false,
        usaEnlace: false,
        nombreDuracionReal: "28 días",
        perfil: "A",
        pin: "1234",
        correo: "netflix@dismanet.test",
        usuario: null,
        codigo: null,
        enlace: null,
        clave: "Net8123@",
      },
      {
        nombrePlataforma: "Disney+ Premium",
        usaPerfilPin: true,
        usaCorreo: true,
        usaUsuario: false,
        usaCodigo: false,
        usaEnlace: false,
        nombreDuracionReal: "30 días",
        perfil: "B",
        pin: "5678",
        correo: "disney@dismanet.test",
        usuario: null,
        codigo: null,
        enlace: null,
        clave: "Dis8123@",
      },
      {
        nombrePlataforma: "Spotify",
        usaPerfilPin: false,
        usaCorreo: true,
        usaUsuario: false,
        usaCodigo: false,
        usaEnlace: false,
        nombreDuracionReal: "30 días",
        perfil: null,
        pin: null,
        correo: "spotify@dismanet.test",
        usuario: null,
        codigo: null,
        enlace: null,
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

// F4.2, parte 1 — quitarBloquesDeCamposNoUsados generaliza la lógica que
// antes solo cubría PERFIL/PIN y CORREO: una plantilla UNIDAD con bloques
// para los 5 campos de acceso debe mostrar u omitir cada uno según la
// bandera correspondiente, sin importar la combinación.
const PLANTILLA_UNIDAD_CON_TODOS_LOS_CAMPOS = `*{{plataforma}} ({{duracion}})*

*PERFIL:*
{{perfil}}

*PIN:*
{{pin}}

*CORREO:*
{{correo}}

*USUARIO:*
{{usuario}}

*CODIGO:*
{{codigo}}

*ENLACE:*
{{enlace}}

*CONTRASEÑA:*
{{clave}}`;

function datosUnidadCamposAcceso(banderas: {
  usaPerfilPin: boolean;
  usaCorreo: boolean;
  usaUsuario: boolean;
  usaCodigo: boolean;
  usaEnlace: boolean;
}): DatosMensajeUnidad {
  return {
    codigoCompra: "DIS000111",
    fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
    nombreTipoCliente: "Nuevo",
    nombreDuracion: "30 días",
    fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
    precioVenta: "15000",
    nombrePlataformaMensaje: "Prime Video",
    ...banderas,
    perfil: banderas.usaPerfilPin ? "A" : null,
    pin: banderas.usaPerfilPin ? "1234" : null,
    correo: banderas.usaCorreo ? "cuenta@dismanet.test" : null,
    usuario: banderas.usaUsuario ? "usuario_prime" : null,
    codigo: banderas.usaCodigo ? "ABC123" : null,
    enlace: banderas.usaEnlace ? "https://primevideo.com/activar" : null,
    clave: "Prime8123@",
  };
}

const ETIQUETAS_CAMPO: Record<"usaPerfilPin" | "usaCorreo" | "usaUsuario" | "usaCodigo" | "usaEnlace", string[]> = {
  usaPerfilPin: ["PERFIL", "PIN"],
  usaCorreo: ["CORREO"],
  usaUsuario: ["USUARIO"],
  usaCodigo: ["CODIGO"],
  usaEnlace: ["ENLACE"],
};

describe("renderizarMensajeUnidad — quitarBloquesDeCamposNoUsados cubre los 5 campos de acceso, cualquier combinación", () => {
  const TODAS_LAS_BANDERAS = ["usaPerfilPin", "usaCorreo", "usaUsuario", "usaCodigo", "usaEnlace"] as const;

  it("con las 5 banderas en true: el mensaje incluye las 5 etiquetas y la contraseña", () => {
    const datos = datosUnidadCamposAcceso({
      usaPerfilPin: true,
      usaCorreo: true,
      usaUsuario: true,
      usaCodigo: true,
      usaEnlace: true,
    });
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD_CON_TODOS_LOS_CAMPOS, datos);
    expect(mensaje).toContain("*PERFIL:*\nA");
    expect(mensaje).toContain("*PIN:*\n1234");
    expect(mensaje).toContain("*CORREO:*\ncuenta@dismanet.test");
    expect(mensaje).toContain("*USUARIO:*\nusuario_prime");
    expect(mensaje).toContain("*CODIGO:*\nABC123");
    expect(mensaje).toContain("*ENLACE:*\nhttps://primevideo.com/activar");
    expect(mensaje).toContain("*CONTRASEÑA:*\nPrime8123@");
    expect(mensaje).not.toMatch(/\{\{\w+\}\}/);
  });

  it("con las 5 banderas en false: el mensaje no menciona ninguna de las 5 etiquetas, pero sí la contraseña", () => {
    const datos = datosUnidadCamposAcceso({
      usaPerfilPin: false,
      usaCorreo: false,
      usaUsuario: false,
      usaCodigo: false,
      usaEnlace: false,
    });
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD_CON_TODOS_LOS_CAMPOS, datos);
    expect(mensaje).not.toContain("PERFIL");
    expect(mensaje).not.toContain("PIN");
    expect(mensaje).not.toContain("CORREO");
    expect(mensaje).not.toContain("USUARIO");
    expect(mensaje).not.toContain("CODIGO");
    expect(mensaje).not.toContain("ENLACE");
    expect(mensaje).toContain("*CONTRASEÑA:*\nPrime8123@");
    expect(mensaje).not.toMatch(/\{\{\w+\}\}/);
  });

  for (const banderaActiva of TODAS_LAS_BANDERAS) {
    it(`solo ${banderaActiva} en true: muestra únicamente esa etiqueta, ninguna otra`, () => {
      const banderas = {
        usaPerfilPin: false,
        usaCorreo: false,
        usaUsuario: false,
        usaCodigo: false,
        usaEnlace: false,
        [banderaActiva]: true,
      } as { usaPerfilPin: boolean; usaCorreo: boolean; usaUsuario: boolean; usaCodigo: boolean; usaEnlace: boolean };

      const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD_CON_TODOS_LOS_CAMPOS, datosUnidadCamposAcceso(banderas));

      for (const otraBandera of TODAS_LAS_BANDERAS) {
        for (const etiqueta of ETIQUETAS_CAMPO[otraBandera]) {
          if (otraBandera === banderaActiva) {
            expect(mensaje).toContain(etiqueta);
          } else {
            expect(mensaje).not.toContain(etiqueta);
          }
        }
      }
      expect(mensaje).toContain("*CONTRASEÑA:*");
      expect(mensaje).not.toMatch(/\{\{\w+\}\}/);
    });
  }
});

// Mismo principio para PAQUETE: bloqueListaCuentas construye las líneas por
// código (no por plantilla), así que cada combinación de banderas por
// componente debe producir exactamente las líneas correspondientes.
function componentePaqueteCamposAcceso(banderas: {
  usaPerfilPin: boolean;
  usaCorreo: boolean;
  usaUsuario: boolean;
  usaCodigo: boolean;
  usaEnlace: boolean;
}) {
  return {
    nombrePlataforma: "Prime Video",
    nombreDuracionReal: "30 días",
    ...banderas,
    perfil: banderas.usaPerfilPin ? "A" : null,
    pin: banderas.usaPerfilPin ? "1234" : null,
    correo: banderas.usaCorreo ? "cuenta@dismanet.test" : null,
    usuario: banderas.usaUsuario ? "usuario_prime" : null,
    codigo: banderas.usaCodigo ? "ABC123" : null,
    enlace: banderas.usaEnlace ? "https://primevideo.com/activar" : null,
    clave: "Prime8123@",
  };
}

// bloqueListaCuentas escribe la etiqueta con tilde ("CÓDIGO"), a diferencia
// de la plantilla UNIDAD de prueba de arriba (texto libre, sin tilde) — cada
// describe usa sus propias etiquetas para no acoplarse a la ortografía del otro.
const ETIQUETAS_CAMPO_PAQUETE: Record<"usaPerfilPin" | "usaCorreo" | "usaUsuario" | "usaCodigo" | "usaEnlace", string[]> = {
  usaPerfilPin: ["PERFIL", "PIN"],
  usaCorreo: ["CORREO"],
  usaUsuario: ["USUARIO"],
  usaCodigo: ["CÓDIGO"],
  usaEnlace: ["ENLACE"],
};

describe("renderizarMensajePaquete — bloqueListaCuentas cubre los 5 campos de acceso por componente, cualquier combinación", () => {
  const TODAS_LAS_BANDERAS = ["usaPerfilPin", "usaCorreo", "usaUsuario", "usaCodigo", "usaEnlace"] as const;

  const datosComunes = {
    codigoCompra: "DIS000222",
    fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
    nombreTipoCliente: "Nuevo",
    nombreDuracion: "30 días",
    fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
    precioVenta: "25000",
    nombrePaquete: "Combo con todo",
  };

  it("con las 5 banderas en true: el bloque incluye las 5 líneas y la contraseña", () => {
    const datos: DatosMensajePaquete = {
      ...datosComunes,
      componentes: [
        componentePaqueteCamposAcceso({ usaPerfilPin: true, usaCorreo: true, usaUsuario: true, usaCodigo: true, usaEnlace: true }),
      ],
    };
    const mensaje = renderizarMensajePaquete("{{listaCuentas}}", datos);
    expect(mensaje).toContain("*PERFIL:* A");
    expect(mensaje).toContain("*PIN:* 1234");
    expect(mensaje).toContain("*CORREO:* cuenta@dismanet.test");
    expect(mensaje).toContain("*USUARIO:* usuario_prime");
    expect(mensaje).toContain("*CÓDIGO:* ABC123");
    expect(mensaje).toContain("*ENLACE:* https://primevideo.com/activar");
    expect(mensaje).toContain("*CONTRASEÑA:* Prime8123@");
  });

  it("con las 5 banderas en false: el bloque no menciona ninguna etiqueta salvo la contraseña", () => {
    const datos: DatosMensajePaquete = {
      ...datosComunes,
      componentes: [
        componentePaqueteCamposAcceso({
          usaPerfilPin: false,
          usaCorreo: false,
          usaUsuario: false,
          usaCodigo: false,
          usaEnlace: false,
        }),
      ],
    };
    const mensaje = renderizarMensajePaquete("{{listaCuentas}}", datos);
    expect(mensaje).not.toContain("PERFIL");
    expect(mensaje).not.toContain("PIN");
    expect(mensaje).not.toContain("CORREO");
    expect(mensaje).not.toContain("USUARIO");
    expect(mensaje).not.toContain("CODIGO");
    expect(mensaje).not.toContain("ENLACE");
    expect(mensaje).toContain("*CONTRASEÑA:* Prime8123@");
  });

  for (const banderaActiva of TODAS_LAS_BANDERAS) {
    it(`solo ${banderaActiva} en true: la línea de ese campo aparece, ninguna otra`, () => {
      const banderas = {
        usaPerfilPin: false,
        usaCorreo: false,
        usaUsuario: false,
        usaCodigo: false,
        usaEnlace: false,
        [banderaActiva]: true,
      } as { usaPerfilPin: boolean; usaCorreo: boolean; usaUsuario: boolean; usaCodigo: boolean; usaEnlace: boolean };

      const datos: DatosMensajePaquete = { ...datosComunes, componentes: [componentePaqueteCamposAcceso(banderas)] };
      const mensaje = renderizarMensajePaquete("{{listaCuentas}}", datos);

      for (const otraBandera of TODAS_LAS_BANDERAS) {
        for (const etiqueta of ETIQUETAS_CAMPO_PAQUETE[otraBandera]) {
          if (otraBandera === banderaActiva) {
            expect(mensaje).toContain(etiqueta);
          } else {
            expect(mensaje).not.toContain(etiqueta);
          }
        }
      }
      expect(mensaje).toContain("*CONTRASEÑA:* Prime8123@");
    });
  }
});

// F4.3 — venta externa: precioVenta llega en 0 porque la Venta esExterna no
// es un ingreso, no porque el comprador no pagó nada. Mostrar "{{precio}}"
// como "$ 0" sería falso, así que ocultarPrecio quita el BLOQUE completo
// (misma mecánica que quitarBloquesDeCamposNoUsados: por línea en blanco,
// nunca por sustitución de cadena vacía, que dejaría la etiqueta huérfana).
const PLANTILLA_UNIDAD_CON_PRECIO = `*{{plataforma}} ({{duracion}})*

*PRECIO:*
{{precio}}

*CONTRASEÑA:*
{{clave}}`;

const PLANTILLA_PAQUETE_CON_PRECIO = `*{{paquete}} ({{duracion}})*

*PRECIO:*
{{precio}}

{{listaCuentas}}`;

describe("ocultarPrecio (F4.3) — quita el bloque de {{precio}} sin dejar la etiqueta huérfana", () => {
  const datosUnidad: DatosMensajeUnidad = {
    codigoCompra: "DIS000222",
    fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
    nombreTipoCliente: "Venta externa",
    nombreDuracion: "30 días",
    fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
    precioVenta: "0",
    ocultarPrecio: true,
    nombrePlataformaMensaje: "N.E.T.F.L.I.X",
    usaPerfilPin: false,
    usaCorreo: false,
    usaUsuario: false,
    usaCodigo: false,
    usaEnlace: false,
    perfil: null,
    pin: null,
    correo: null,
    usuario: null,
    codigo: null,
    enlace: null,
    clave: "Net8123@",
  };

  it("renderizarMensajeUnidad: con ocultarPrecio quita *PRECIO:* y {{precio}} enteros, no solo el marcador", () => {
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD_CON_PRECIO, datosUnidad);
    expect(mensaje).not.toContain("PRECIO");
    expect(mensaje).not.toContain("$0");
    expect(mensaje).not.toMatch(/\{\{\w+\}\}/);
    expect(mensaje).toContain("*CONTRASEÑA:*\nNet8123@");
  });

  it("renderizarMensajeUnidad: sin ocultarPrecio (venta normal) el bloque de precio se conserva", () => {
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD_CON_PRECIO, {
      ...datosUnidad,
      nombreTipoCliente: "Nuevo",
      precioVenta: "15000",
      ocultarPrecio: false,
    });
    expect(mensaje).toContain("*PRECIO:*");
    expect(mensaje).toContain("15.000");
  });

  it("renderizarMensajePaquete: con ocultarPrecio quita *PRECIO:* y {{precio}} enteros", () => {
    const datosPaquete: DatosMensajePaquete = {
      codigoCompra: "DIS000333",
      fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
      nombreTipoCliente: "Venta externa",
      nombreDuracion: "30 días",
      fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
      precioVenta: "0",
      ocultarPrecio: true,
      nombrePaquete: "Básico 1",
      componentes: [
        {
          nombrePlataforma: "N.E.T.F.L.I.X",
          usaPerfilPin: false,
          usaCorreo: false,
          usaUsuario: false,
          usaCodigo: false,
          usaEnlace: false,
          nombreDuracionReal: "30 días",
          perfil: null,
          pin: null,
          correo: null,
          usuario: null,
          codigo: null,
          enlace: null,
          clave: "Net8123@",
        },
      ],
    };
    const mensaje = renderizarMensajePaquete(PLANTILLA_PAQUETE_CON_PRECIO, datosPaquete);
    expect(mensaje).not.toContain("PRECIO");
    expect(mensaje).not.toContain("$0");
    expect(mensaje).not.toMatch(/\{\{\w+\}\}/);
    expect(mensaje).toContain("*CONTRASEÑA:* Net8123@");
  });
});

describe("Hotfix — limpieza de campos no usados en plantillas de un solo bloque y multilineas", () => {
  const PLANTILLA_PRODUCCION = `*CORREO:* {{correo}}
*CONTRASEÑA:* {{clave}}
*CODIGO DE COMPRA* {{codigoCompra}}
*PERFIL:* {{perfil}}
*PIN:* {{pin}}`;

  const datos: DatosMensajeUnidad = {
    codigoCompra: "DIS995865",
    fechaVenta: new Date("2026-09-27T15:00:00.000Z"),
    nombreTipoCliente: "Cliente normal",
    nombreDuracion: "30 días",
    fechaVencimientoMax: new Date("2026-10-27T15:00:00.000Z"),
    precioVenta: "15000",
    nombrePlataformaMensaje: "Netflix",
    usaPerfilPin: false,
    usaCorreo: true,
    usaUsuario: false,
    usaCodigo: false,
    usaEnlace: false,
    perfil: null,
    pin: null,
    correo: "cuenta@dismanet.test",
    usuario: null,
    codigo: null,
    enlace: null,
    clave: "Net8123@",
  };

  it("(a) la plantilla real de producción conserva correo, contraseña y código de compra, y no tiene perfil ni pin", () => {
    const mensaje = renderizarMensajeUnidad(PLANTILLA_PRODUCCION, datos);
    expect(mensaje).toContain("*CORREO:* cuenta@dismanet.test");
    expect(mensaje).toContain("*CONTRASEÑA:* Net8123@");
    expect(mensaje).toContain("*CODIGO DE COMPRA* DIS995865");
    expect(mensaje).not.toContain("PERFIL");
    expect(mensaje).not.toContain("PIN");
  });

  it("(b) la plantilla por defecto (Anexo B) elimina el bloque de perfil y pin completo sin dejar etiqueta huérfana", () => {
    const mensaje = renderizarMensajeUnidad(PLANTILLA_UNIDAD, datos);
    expect(mensaje).not.toContain("PERFIL");
    expect(mensaje).not.toContain("PIN");
    expect(mensaje).toContain("*CORREO:*\ncuenta@dismanet.test");
    expect(mensaje).toContain("*CONTRASEÑA:*\nNet8123@");
    expect(mensaje).toContain("DIS995865");
  });

  it("en un bloque mixto multilínea, elimina la etiqueta huérfana de perfil/pin sin afectar los demás campos", () => {
    const plantillaMixta = `*DATOS DE ACCESO*
*CORREO:* {{correo}}
*CONTRASEÑA:* {{clave}}
*PERFIL:*
{{perfil}}
*PIN:*
{{pin}}`;
    const mensaje = renderizarMensajeUnidad(plantillaMixta, datos);
    expect(mensaje).toContain("*DATOS DE ACCESO*");
    expect(mensaje).toContain("*CORREO:* cuenta@dismanet.test");
    expect(mensaje).toContain("*CONTRASEÑA:* Net8123@");
    expect(mensaje).not.toContain("PERFIL");
    expect(mensaje).not.toContain("PIN");
  });

  it("los marcadores comunes nunca cuentan como no usados ni justifican borrar nada", () => {
    const plantillaComunes = `*INFO*
Código: {{codigoCompra}}
Precio: {{precio}}
Duración: {{duracion}}
Fecha: {{fecha}}
Fecha letras: {{fechaEnLetras}}
Vence: {{fechaVencimiento}}
Cliente: {{tipoCliente}}
Celular: {{celular}}
Plataforma: {{plataforma}}
*PERFIL:* {{perfil}}`;
    const mensaje = renderizarMensajeUnidad(plantillaComunes, datos);
    expect(mensaje).toContain("Código: DIS995865");
    expect(mensaje).toContain("Precio:");
    expect(mensaje).toContain("Duración: 30 días");
    expect(mensaje).toContain("Cliente: Cliente normal");
    expect(mensaje).toContain("Plataforma: Netflix");
    expect(mensaje).not.toContain("PERFIL");
  });
});
