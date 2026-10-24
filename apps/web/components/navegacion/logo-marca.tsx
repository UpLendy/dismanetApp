import Image from "next/image";

// LogoMarca — DISENO.md §3. 120px de ancho: el mínimo del manual de marca
// para el logo completo (por debajo de eso va el símbolo solo, que no
// aplica aquí porque la barra lateral es fija de 240px, nunca colapsa a un
// ancho menor). El claro/oscuro se decide por CSS (.logo-marca-claro /
// .logo-marca-oscuro en globals.css), no por JS, para que no haya
// parpadeo al cargar.
export function LogoMarca() {
  return (
    <span className="relative block h-8 w-[120px] shrink-0">
      <Image
        src="/marca/logo-claro.png"
        alt="DISMANET"
        width={120}
        height={32}
        priority
        className="logo-marca-claro absolute inset-0 h-full w-full object-contain object-left"
      />
      <Image
        src="/marca/logo-oscuro.png"
        alt="DISMANET"
        width={120}
        height={32}
        priority
        className="logo-marca-oscuro absolute inset-0 h-full w-full object-contain object-left"
      />
    </span>
  );
}
