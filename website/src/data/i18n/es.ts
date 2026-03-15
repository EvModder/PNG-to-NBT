/**
 * Public API:
 * - esCatalog
 *
 * Callers:
 * - src/lib/messages.ts
 */
import { type Shade } from "@/data/mapColors";
import { BuildMode } from "@/lib/conversionTypes";
import { type MessageCatalog } from "@/data/i18n/en";
import { type BlockDisplayMode, type ColumnId, SupportMode } from "@/lib/uiTypes";

type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

// Callers:
// - src/lib/messages.ts
export const esCatalog = {
  locale: "es",
  common: {
    none: "(ninguno)",
    requiredBadge: "R:",
    add: "Añadir",
    remove: "Quitar",
    close: "Cerrar",
    share: "Compartir",
    deleteShort: "Borr.",
    clearSelectionSymbol: "∅",
    missingTextureSymbol: "?",
    openSecretsSettings: "Abrir ajustes secretos",
    toggleThemeAriaLabel: "Cambiar tema",
    unsavedChanges: "Cambios sin guardar",
    newPresetTitle: "Nuevo preset",
  },
  app: {
    title: "Imagen → NBT",
  },
  blocks: {
    iceWaterTooltip:
      "El hielo puede colocarse en lugar de agua o bloques anegados, pero debe convertirse a agua dentro del juego para obtener los colores correctos del mapa.",
    iceWaterOptionTitle: "{blockId} - {tooltip}",
  },
  presets: {
    label: "Preset:",
    builtInGroupLabel: "Integrados",
    customGroupLabel: "Personalizados",
    copiedUrlAlert: "¡URL del preset copiada al portapapeles!",
    namePrompt: "Introduce el nombre del preset:",
    builtinTooltips: {
      Fullblock: "Preset de uso general que utiliza sobre todo bloques completos y tablones para cada color del mapa.",
      Carpets: "Usa variantes de alfombra cuando están disponibles para reducir la altura y el coste de bloques.",
      PistonClear: "Usa bloques compatibles con limpieza por pistón o atravesables, incluyendo sustitutos transparentes especiales cuando hace falta.",
    },
  },
  supportMode: {
    label: "Soporte:",
    optionLabels: {
      [SupportMode.None]: "Ninguno",
      [SupportMode.Steps]: "Escalones",
      [SupportMode.All]: "Todo",
      [SupportMode.Fragile]: "Frágil",
      [SupportMode.Water]: "Agua",
    } as const satisfies Record<SupportMode, string>,
    tooltips: {
      [SupportMode.None]: "Sin bloques de soporte (solo sombreado)",
      [SupportMode.Steps]: "Añade bloques de soporte debajo de los escalones.",
      [SupportMode.All]: "Añade bloques de soporte debajo de cada bloque.",
      [SupportMode.Fragile]: "Añade bloques de soporte debajo de los bloques frágiles.",
      [SupportMode.Water]: "Añade bloques de soporte alrededor del agua, o debajo de pilares de hielo (si se usa en lugar de agua).",
    } as const satisfies Record<SupportMode, string>,
    selectedFallbackTooltip: "Modo de soporte seleccionado.",
  },
  buildMode: {
    label: "Sombreado:",
    staircaseGroupLabel: "Escalera",
    suppressGroupLabel: "Supresión",
    layerGapLabel: "Separación de capas:",
    layerGapTooltip:
      "La separación de capas controla el espacio vertical entre las secciones inferior y superior de la supresión de 2 capas.",
    mixStepsLabel: "Mezclar pasos:",
    mixStepsTooltip:
      "Permite que pasos adyacentes de supresión E→O compartan bloques de color recesivos reutilizables, reduciendo los bloques colocados o minados entre pasos pero haciendo menos uniforme la transición entre fases.",
    paletteSeedLabel: "Semilla de paleta:",
    optionLabels: {
      [BuildMode.Flat]: "Plano",
      [BuildMode.InclineUp]: "Inclinación (Sube)",
      [BuildMode.InclineDown]: "Inclinación (Baja)",
      [BuildMode.StaircaseNorthline]: "Escalera (Northline)",
      [BuildMode.StaircaseSouthline]: "Escalera (Southline)",
      [BuildMode.StaircaseClassic]: "Escalera (Clásica)",
      [BuildMode.StaircaseValley]: "Escalera (Valle)",
      [BuildMode.StaircaseGrouped]: "Escalera (Agrupada)",
      [BuildMode.StaircaseParty]: "Escalera (Party)",
      [BuildMode.SuppressSplitRow]: "Supresión (división por filas)",
      [BuildMode.SuppressSplitChecker]: "Supresión (división ajedrezada)",
      [BuildMode.SuppressCheckerEW]: "Supresión (ajedrez, E→O)",
      [BuildMode.SuppressPairsEW]: "Supresión (pares, E→O)",
      [BuildMode.Suppress2Layer]: "Supresión (2 capas)",
      [BuildMode.Suppress2LayerLateFillers]: "Supresión (2 capas, rellenos tardíos)",
      [BuildMode.Suppress2LayerLatePairs]: "Supresión (2 capas, pares tardíos)",
    } as const satisfies Record<BuildMode, string>,
    tooltips: {
      [BuildMode.Flat]: "Plano: todos los bloques de color de la forma generada están al mismo nivel Y.",
      [BuildMode.InclineUp]:
        "Todos los píxeles no transparentes y no acuáticos suben de forma uniforme, así que todos los métodos de escalera colapsan a este alias de inclinación ascendente (la misma salida backend que northline).",
      [BuildMode.InclineDown]:
        "Todos los píxeles no transparentes y no acuáticos bajan de forma uniforme, así que todos los métodos de escalera colapsan a este alias de inclinación descendente (la misma salida backend que northline).",
      [BuildMode.StaircaseNorthline]: "Alinea cada columna N→S desde una línea de referencia (noobline) de bloques",
      [BuildMode.StaircaseSouthline]: "Alinea cada columna S→N desde una línea de referencia de bloques (la fila inferior)",
      [BuildMode.StaircaseClassic]: "Minimiza la diferencia maxY-minY manteniendo contiguas las columnas N→S",
      [BuildMode.StaircaseValley]:
        "Minimiza la diferencia maxY-minY y divide las columnas N→S, bajando cada segmento todo lo posible",
      [BuildMode.StaircaseGrouped]:
        "Segmentación estilo valle con agrupación segura entre columnas para reducir tramos bajos aislados",
      [BuildMode.StaircaseParty]: "El mismo MapArt, pero hace el proceso de construcción más divertido y emocionante.",
      [BuildMode.SuppressSplitRow]: "División por filas; se mantiene por compatibilidad, pero en general no es útil",
      [BuildMode.SuppressSplitChecker]: "Divide las generaciones NBT para colocaciones dominantes/recesivas",
      [BuildMode.SuppressCheckerEW]:
        "Como Supresión (2 capas), pero codificada como fases E→O separadas verticalmente en vez de capas superior/inferior. Cada paso maneja 4 columnas: 2 columnas dominantes más lejanas y 2 columnas recesivas más cercanas. Construye y actualiza un paso, luego reconstruye el siguiente más lejos para remapear las columnas dominantes sin remapear las recesivas cercanas.",
      [BuildMode.SuppressPairsEW]:
        "Supresión E→O por pasos en pares entrelazados. Cada paso actualiza un píxel dominante más lejano y un píxel recesivo más cercano de columnas adyacentes; luego se reconstruye el siguiente paso más lejos para remapear el dominante sin remapear el recesivo.",
      [BuildMode.Suppress2Layer]:
        "Pasos:\n1) Construye todo\n2) Actualiza el mapa completo\n3) Retira la capa superior, 1-2 columnas cada vez\n4) Actualiza con cuidado *solo* los píxeles dominantes de la(s) columna(s) objetivo\n5) Repite, columna por columna, para todo el mapa\n\nLa separación de capas controla el espacio vertical entre las capas de supresión inferior y superior.",
      [BuildMode.Suppress2LayerLateFillers]:
        "Las colocaciones de la fase de supresión usan un bloque de 'relleno tardío' personalizado (en la capa inferior) y deben omitirse durante la fase inicial de construcción.\n\nPasos:\n1) Construye todos los bloques 'no tardíos'\n2) Actualiza el mapa completo\n3) Retira la capa superior, 1-2 columnas cada vez\n4) Para cada columna retirada, añade los bloques tardíos\n5) Actualiza con cuidado *solo* los píxeles dominantes de la(s) columna(s) objetivo\n6) Repite para todo el mapa\n\nLa separación de capas controla el espacio vertical entre las capas de supresión inferior y superior.",
      [BuildMode.Suppress2LayerLatePairs]:
        "Las colocaciones de la fase de supresión usan un bloque de 'relleno tardío' personalizado (en la capa Y más alta) y deben omitirse durante la fase inicial de construcción.\n\nPasos:\n1) Construye todos los bloques 'no tardíos'\n2) Actualiza el mapa completo\n3) Retira la capa superior, 1-2 columnas cada vez\n4) Para cada columna retirada, añade los bloques tardíos\n5) Actualiza con cuidado *solo* los píxeles dominantes de la(s) columna(s) objetivo\n6) Repite para todo el mapa\n\nLa separación de capas controla el espacio vertical entre las capas de supresión inferior y superior.",
    } as const satisfies Record<BuildMode, string>,
    selectedFallbackTooltip: "Método de sombreado seleccionado.",
  },
  fillers: {
    heading: "Rellenos",
    headingTooltip: "Asignaciones de bloques de relleno para soporte, sombreado y colocaciones de casos especiales.",
    supportLabel: "Soporte:",
    supportTooltip:
      "Se usa para colocaciones de relleno de soporte y conveniencia, incluyendo Escalones, Todo, Frágil, soporte de agua y conectores de camino de agua.",
    supportPlaceholder: "resin_block",
    supportRequiredTooltip: "Colocaciones de relleno de soporte/conveniencia requeridas para el rango de salida actual.",
    shadeLabel: "Sombra:",
    nooblineLabel: "Noobline:",
    shadeTooltip: "Se usa para las colocaciones de relleno de sombreado de la fila norte y de supresión.",
    nooblineTooltip: "Se usa para las colocaciones de relleno de sombreado de la fila norte.",
    shadeRequiredTooltip:
      "Colocaciones de relleno requeridas para el sombreado de la fila norte y de supresión en el rango de salida actual.",
    nooblineRequiredTooltip: "Colocaciones de relleno requeridas para el sombreado de la fila norte en el rango de salida actual.",
    dominateVoidLabel: "VS-1:",
    dominateVoidWarningLabel: "VS-Relleno-1",
    dominateVoidTooltip:
      "Se usa cuando un píxel dominante transparente es sobrescrito por un bloque de relleno para sombrear el bloque situado directamente al sur. Este relleno tendrá que suprimirse manualmente después de construir el NBT.",
    dominateVoidPlaceholder: "slime_block",
    dominateVoidRequiredTooltip: "Colocaciones requeridas de VS-Relleno-1 para el rango de salida actual.",
    recessiveVoidLabel: "VS-2:",
    recessiveVoidWarningLabel: "VS-Relleno-2",
    recessiveVoidTooltip:
      "Se usa cuando un píxel recesivo transparente es sobrescrito por un bloque de relleno para sombrear el bloque situado directamente al sur. Este relleno tendrá que suprimirse manualmente después de construir el NBT.",
    recessiveVoidPlaceholder: "honey_block",
    recessiveVoidRequiredTooltip: "Colocaciones requeridas de VS-Relleno-2 para el rango de salida actual.",
    voidFillersWarningLabel: "VS-Rellenos",
    lateLabel: "Tardío:",
    lateTooltip: "Usado por Supresión (2 capas, rellenos tardíos) para colocaciones tardías de supresión en la capa inferior.",
    latePlaceholder: "slime_block",
    lateRequiredTooltip: "Colocaciones requeridas del relleno tardío para el rango de salida actual.",
  },
  table: {
    title: "Color → Bloque",
    toggleIds: "IDs",
    toggleNames: "Nombres",
    toggleOptions: "#Opc.",
    toggleBlockDisplayTitle: "Cambiar modo de visualización de bloques",
    blockDisplayLabels: {
      names: "nombres",
      textures: "texturas",
    } as const satisfies Record<BlockDisplayMode, string>,
    mcUnitsLabel: "Unid. MC:",
    columnLabels: {
      clr: "Clr",
      id: "ID",
      name: "Nombre",
      block: "Bloque",
      options: "Opciones",
      required: "Necesario",
    } as const satisfies Record<ColumnId, string>,
    columnSortTitles: {
      clr: "Ordenar por tono de color",
      id: "Ordenar por ID de color",
      name: "Ordenar por nombre del color",
      block: "Bloque asignado usado para este color",
      options: "Ordenar por número de opciones de bloque disponibles",
      required: "Ordenar por el recuento requerido de bloques en la salida actual",
    } as const satisfies Record<ColumnId, string>,
    blockColumnResizeExpanded: "Contraer la columna de bloques al ancho mínimo",
    blockColumnResizeCollapsed: "Expandir la columna de bloques para llenar el ancho disponible",
    blockColumnAriaExpanded: "Contraer la columna de bloques",
    blockColumnAriaCollapsed: "Expandir la columna de bloques",
    unusedColorsLabel: {
      one: "{count} color sin usar (no está en la imagen)",
      other: "{count} colores sin usar (no están en la imagen)",
    } as PluralForms,
  },
  customColors: {
    title: "Mapeos de colores personalizados",
    tooltip:
      "El RGB personalizado se interpreta como el tono base/claro para el color ID.\nLos tonos oscuro y plano se derivan automáticamente usando los multiplicadores estándar.\nUna vez añadido, los tres tonos nuevos estarán disponibles para usar en las imágenes de entrada.",
    ariaLabel: "Información del sombreado de color personalizado",
    customRgbOption: "RGB personalizado",
    blockLabel: "Bloque",
    blockPlaceholder: "p. ej. fart_block",
  },
  upload: {
    title: "Vista previa de imagen",
    placeholder: "Haz clic o suelta una imagen de 128×128",
    removeButton: "Quitar",
    convertButtonConverting: "Convirtiendo...",
    convertButtonNbt: "Generar .nbt",
    convertButtonZip: "Generar .zip",
  },
  preview: {
    missingBlockAssignments: {
      one: "{count} color de la imagen no tiene bloque asignado en el preset.",
      other: "{count} colores de la imagen no tienen bloque asignado en el preset.",
    } as PluralForms,
    northRowAlignmentInfo:
      "Nota: Alinea el área de color 128x128 con la cuadrícula del mapa.\nEspera 1 fila norte adicional arriba (el NBT es 128x129).",
    iceConversionInfo:
      "Nota: Se ha seleccionado hielo para el color del agua.\nConviértelo en agua dentro del juego para que los colores sean correctos.",
    noFillerNorthRowLine: "El sombreado de la fila norte requiere colocaciones de relleno.",
    noFillerSuppressLine: "El sombreado de supresión requiere colocaciones de relleno.",
    noFillerInGridLine: "Se requieren algunos rellenos críticos de sombreado dentro de la cuadrícula de 128x128.",
    noFillerWarning: "El relleno de sombra está desactivado ({value}).\n{lines}",
    waterSideSupportInvalid:
      "El relleno de soporte no es válido ({value}).\nAlgunos soportes laterales de agua requieren un bloque color_id=0, así que esas colocaciones no se contarán ni se exportarán.",
    waterSideSupportNotColorIdZero:
      "El relleno de soporte no es color_id=0 ({value}).\nAlgunos soportes laterales de agua requieren un bloque color_id=0, así que esas colocaciones no se contarán ni se exportarán.",
    vsFillerInvalid: {
      one: "{label} no es válido ({value}).\nHabrá {count} píxel noob.",
      other: "{label} no es válido ({value}).\nHabrá {count} píxeles noob.",
    } as PluralForms,
    vsFillerRequiredSingularLabel: {
      one: "{label} es obligatorio para esta imagen.\n{count} punto necesitará supresión manual del color.",
      other: "{label} es obligatorio para esta imagen.\n{count} puntos necesitarán supresión manual del color.",
    } as PluralForms,
    vsFillerRequiredPluralLabel: {
      one: "{label} son obligatorios para esta imagen.\n{count} punto necesitará supresión manual del color.",
      other: "{label} son obligatorios para esta imagen.\n{count} puntos necesitarán supresión manual del color.",
    } as PluralForms,
    vsFillersInvalid: {
      one: "Los VS-Rellenos no son válidos ({first}, {second}). Habrá {count} píxel noob (sur de un transparente con sombreado incorrecto).",
      other:
        "Los VS-Rellenos no son válidos ({first}, {second}). Habrá {count} píxeles noob (sur de un transparente con sombreado incorrecto).",
    } as PluralForms,
    lateFillerInvalid: {
      one: "El relleno tardío no es válido ({value}).\n{count} punto tardío de supresión requiere sombreado.",
      other: "El relleno tardío no es válido ({value}).\n{count} puntos tardíos de supresión requieren sombreado.",
    } as PluralForms,
    uniqueColorCount: {
      one: "{count} color único",
      other: "{count} colores únicos",
    } as PluralForms,
    blockTypeCount: {
      one: "{count} tipo de bloque",
      other: "{count} tipos de bloque",
    } as PluralForms,
    voidShadowCount: {
      one: "{count} sombra de vacío",
      other: "{count} sombras de vacío",
    } as PluralForms,
    stepRangeButton: "Rango de pasos",
    columnRangeButton: "Rango de columnas",
  },
  swatches: {
    transparent: "Transparente",
    shadeLabels: {
      0: "oscuro",
      1: "plano",
      2: "claro",
      3: "más oscuro (inobtenible)",
    } as const satisfies Record<Shade, string>,
    shadeTooltip: "{hex} - Haz clic para copiar ({shade})",
  },
  dialogs: {
    secretSettingsTitle: "Configuración secreta",
    options: {
      showTransparentRow: "Mostrar fila color_id=0",
      showExcludedBlocks: "Mostrar bloques excluidos",
      forceZ129: "Ancho Z siempre 129",
      assumeFloor: "Suponer suelo",
      showAlignmentReminder: "Mostrar recordatorio de alineación",
      showNooblineWarnings: "Mostrar advertencias para nooblines",
      showVsFillerWarnings: "Mostrar advertencias cuando los VS-Rellenos sean necesarios en mapas Staircase",
    },
  },
  credits: {
    title: "Créditos",
    evModderName: "EvModder",
    evModderUrl: "https://www.youtube.com/@evmodder",
    evModderRole: "Desarrollador",
    rebaneName: "Rebane2001",
    rebaneUrl: "https://rebane2001.com/",
    rebaneRole: "Creador original de {name}",
    mapArtCraftName: "MapArtCraft",
    mapArtCraftUrl: "https://mike2b2t.github.io/mapartcraft/",
    gu2t4vName: "Gu2t4v",
    gu2t4vUrl: "https://youtube.com/@gust4v_",
    gu2t4vRole: "Experto en supresión, inventor del método de 2 capas",
    gptNote: "Nota: se usó GPT para partes de este sitio",
  },
  parsing: {
    unableToCreateImageCanvas: "No se pudo crear el lienzo de la imagen.",
    failedToDecodeImage: "No se pudo decodificar la imagen.",
    browserDecodeFailure: "No se puede decodificar este formato de imagen en el navegador.",
    tiffNoImageData: "El archivo TIFF no contiene datos de imagen.",
    genericDecodeFailure: "No se puede decodificar este formato de imagen.",
    conversionFailed: "La conversión falló",
    imageSizeError: "La imagen debe ser de 128×128 píxeles (se obtuvo {width}×{height})",
    unsupportedPaletteColors: {
      one: "Se encontró {count} color que no está en la paleta de mapas de Minecraft:\n\n{colors}{ellipsis}",
      other: "Se encontraron {count} colores que no están en la paleta de mapas de Minecraft:\n\n{colors}{ellipsis}",
    } as PluralForms,
    rgbColor: "rgb({r},{g},{b})",
    conversionSummaryAll: {
      one: "Se convirtió {convertedCount} color al ID de paleta más cercano.",
      other: "Se convirtieron {convertedCount} colores al ID de paleta más cercano.",
    } as PluralForms,
    conversionSummaryPartial: {
      one: "Se convirtió {convertedCount} (de {totalInputColorCount}) color al ID de paleta más cercano.",
      other: "Se convirtieron {convertedCount} (de {totalInputColorCount}) colores al ID de paleta más cercano.",
    } as PluralForms,
    reducedUniqueColors: {
      one: "{count} color único menos que en la imagen fuente.",
      other: "{count} colores únicos menos que en la imagen fuente.",
    } as PluralForms,
    lossyFormatHint: "Esto probablemente se debe a que {formatLabel} es un formato con pérdida.",
  },
} satisfies MessageCatalog;
