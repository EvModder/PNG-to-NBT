/**
 * Public API:
 * - esCatalog
 *
 * Callers:
 * - src/lib/messages.ts
 */
import { Shade } from "@/types/color";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { type MessageCatalog } from "@/data/i18n/en";
import { type BlockDisplayMode, type ColumnId, SupportMode } from "@/types/ui";

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
    clearSelectionSymbol: "∅",
    missingTextureSymbol: "?",
    openSecretsSettings: "Abrir ajustes secretos",
    toggleThemeAriaLabel: "Cambiar tema",
    languageAriaLabel: "Idioma",
    languageBrowserOption: "Navegador",
    unsavedChanges: "Cambios sin guardar",
    newPresetTitle: "Nombrar nuevo preset según la configuración actual",
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
    copiedUrlAlert: "¡URL compartible copiada al portapapeles!",
    namePrompt: "Introduce el nombre del preset:",
    saveTitle: "Guardar las ediciones actuales del preset",
    shareTitle: "Copiar la URL compartible al portapapeles",
    deleteTitle: "Eliminar el preset personalizado actual",
    builtinTooltips: {
      Fullblock: "Preset de uso general que utiliza sobre todo bloques completos y tablones para cada color del mapa.",
      Carpets: "Usa variantes de alfombra cuando están disponibles para reducir la altura y el coste de bloques.",
      PistonClear: "Usa bloques compatibles con limpieza por pistón o atravesables, incluyendo sustitutos transparentes especiales cuando hace falta.",
      CrubTech: "Bloques pensados para la plataforma CrubTech suppress de 2 capas.",
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
      [SupportMode.Steps]: "Añade bloques de soporte debajo de los bloques elevados.",
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
    crubTechLabel: "CrubTech",
    crubTechTooltip:
      "Para los esquemas suppress de 2 capas, divide los rellenos de sombreado superiores entre variantes rompibles y empujables para que los rellenos adyacentes este-oeste no usen todos el mismo comportamiento de CrubTech.",
    latePairsGapLabel: "Separación de pares tardios:",
    latePairsGapTooltip: "Separacion vertical sobre el bloque superior normal de 2 capas usada para las colocaciones de pares tardios agregadas durante cada fase suppress.",
    layerGapLabel: "Separación de capas:",
    layerGapTooltip:
      "La separación de capas controla el espacio vertical entre las secciones inferior y superior de la supresión de 2 capas.",
    mixStepsLabel: "Printer+Nuker:",
    mixStepsTooltip:
      "Permite que pasos adyacentes de supresión compartan bloques de color recesivos reutilizables, reduciendo los bloques colocados o minados entre pasos pero haciendo menos uniforme la transición entre fases.",
    buildAtWorldMinYLabel: "Construir en minY mundial:",
    buildAtWorldMinYTooltip:
      "Optimización para mapas planos: construye el mapa en la Y mínima del mundo para que los píxeles de tono plano justo al sur de transparencia dentro de la cuadrícula no requieran rellenos de sombra de vacío.",
    waterShadeNames: {
      [Shade.Dark]: "oscuro",
      [Shade.Flat]: "medio",
      [Shade.Light]: "claro",
    } as const,
    waterLevelTooltip:
      "Agua de tono {shadeName}: 0 coloca el bloque de agua de este tono en la Y del piso no acuoso. Cada incremento lo baja 1 bloque más. Los tonos de agua usados deben tener valores distintos.",
    waterLevelAriaLabel: "Nivel de agua para el tono {shadeName}",
    paletteSeedLabel: "Semilla de paleta:",
    stepDirectionLabels: {
      [SuppressStepDirection.EastToWest]: "E→O",
      [SuppressStepDirection.WestToEast]: "O→E",
      [SuppressStepDirection.NorthToSouth]: "N→S",
      [SuppressStepDirection.SouthToNorth]: "S→N",
    } as const satisfies Record<SuppressStepDirection, string>,
    stepDirectionTooltip: "Dirección de supresión: {directionLabel}. Haz clic para alternar.",
    stepDirectionAriaLabel: "Dirección de supresión {directionLabel}",
    optionLabels: {
      [BuildMode.Flat]: "Plano",
      [BuildMode.InclineUp]: "Inclinación (Sube)",
      [BuildMode.InclineDown]: "Inclinación (Baja)",
      [BuildMode.StaircaseNorthline]: "Escalera (Northline)",
      [BuildMode.StaircaseSouthline]: "Escalera (Southline)",
      [BuildMode.StaircaseClassic]: "Escalera (Clásica)",
      [BuildMode.StaircaseValley]: "Escalera (Valle)",
      [BuildMode.StaircaseGroup]: "Escalera (Grupo)",
      [BuildMode.StaircaseParty]: "Escalera (Party)",
      [BuildMode.SuppressSplitRow]: "Supresión (división: filas)",
      [BuildMode.SuppressSplitChecker]: "Supresión (división: ajedrez)",
      [BuildMode.SuppressStepPairs]: "Supresión (pasos: pares)",
      [BuildMode.SuppressStepChecker]: "Supresión (pasos: ajedrez)",
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
      [BuildMode.StaircaseGroup]:
        "Segmentación estilo valle con agrupación segura entre columnas para reducir tramos bajos aislados",
      [BuildMode.StaircaseParty]: "El mismo MapArt, pero hace el proceso de construcción más divertido y emocionante.",
      [BuildMode.SuppressSplitRow]: "División por filas; se mantiene por compatibilidad, pero en general no es útil",
      [BuildMode.SuppressSplitChecker]: "Divide las generaciones NBT para colocaciones dominantes/recesivas",
      [BuildMode.SuppressStepPairs]:
        "Supresión por pasos en pares entrelazados. La dirección actual se selecciona por separado. Cada paso actualiza un píxel dominante más lejano y un píxel recesivo más cercano de líneas adyacentes; luego se reconstruye el siguiente paso más lejos para remapear el dominante sin remapear el recesivo.",
      [BuildMode.SuppressStepChecker]:
        "Como Supresión (2 capas), pero codificada como fases separadas verticalmente en vez de capas superior/inferior. La dirección actual se selecciona por separado. Cada paso maneja 4 líneas: 2 líneas dominantes más lejanas y 2 líneas recesivas más cercanas.",
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
    supportRequiredTooltip: "Colocaciones de relleno de soporte/conveniencia requeridas para el rango de salida actual.",
    shadeLabel: "Sombra:",
    nooblineLabel: "Noobline:",
    shadeTooltip: "Se usa para las colocaciones de relleno de sombreado de la fila norte y de supresión.",
    nooblineTooltip: "Se usa para las colocaciones de relleno de sombreado de la fila norte.",
    shadeRequiredTooltip:
      "Colocaciones de relleno requeridas para el sombreado de la fila norte y de supresión en el rango de salida actual.",
    nooblineRequiredTooltip: "Colocaciones de relleno requeridas para el sombreado de la fila norte en el rango de salida actual.",
    crubTechBreakableLabel: "Shade-Breakable:",
    crubTechSupportBreakableLabel: "Support/Shade-Breakable:",
    crubTechBreakableTooltip:
      "Usado para las colocaciones de sombreado y soporte de 2 capas de CrubTech que deben romperse al ser empujadas por pistón/slime.",
    crubTechBreakableRequiredTooltip:
      "Colocaciones requeridas del relleno rompible de sombreado y soporte de CrubTech para el rango de salida actual.",
    crubTechPushableLabel: "Shade-Pushable:",
    crubTechSupportPushableLabel: "Support/Shade-Pushable:",
    crubTechPushableTooltip:
      "Usado para las colocaciones de sombreado y soporte de 2 capas de CrubTech que deben seguir siendo empujables por pistón/slime.",
    crubTechPushableRequiredTooltip:
      "Colocaciones requeridas del relleno empujable de sombreado y soporte de CrubTech para el rango de salida actual.",
    dominateVoidLabel: "VS-1:",
    dominateVoidWarningLabel: "VS-Relleno-1",
    dominateVoidTooltip:
      "Cuando un píxel dominante necesita sombreado plano/oscuro, pero el píxel al norte es transparente.\n\nIncluye este relleno en la construcción/carga inicial.\nAl actualizar: elimínalo y luego recarga SOLO el píxel del norte (transparente).",
    dominateVoidRequiredTooltip: "Colocaciones requeridas de VS-Relleno-1 para el rango de salida actual.",
    recessiveVoidLabel: "VS-2:",
    recessiveVoidWarningLabel: "VS-Relleno-2",
    recessiveVoidTooltip:
      "Cuando un píxel recesivo necesita sombreado plano/oscuro, pero el píxel al norte es transparente.\n\nOmite este relleno en la construcción/carga inicial.\nAl actualizar: colócalo y luego recarga SOLO el píxel del sur (de color).",
    recessiveVoidRequiredTooltip: "Colocaciones requeridas de VS-Relleno-2 para el rango de salida actual.",
    voidFillersWarningLabel: "VS-Rellenos",
    lateLabel: "Tardío:",
    lateTooltip: "Usado por Supresión (2 capas, rellenos tardíos) para colocaciones tardías de supresión en la capa inferior.",
    lateRequiredTooltip: "Colocaciones requeridas del relleno tardío para el rango de salida actual.",
  },
  table: {
    title: "Color → Bloque",
    titleTooltip: "Selecciona qué bloque usar para cada color.",
    toggleIds: "IDs",
    toggleNames: "Nombres",
    toggleOptions: "#Opc.",
    toggleBlockDisplayTitle: "Cambiar modo de visualización de bloques",
    blockDisplayLabels: {
      names: "nombres",
      textures: "texturas",
    } as const satisfies Record<BlockDisplayMode, string>,
    mcUnitsLabel: "Unid. MC:",
    mcUnitsTooltip: "Muestra los recuentos de materiales en cajas de shulker y montones de objetos.",
    maxPerSplitLabel: "Máx. por split:",
    maxPerSplitTooltip: "Muestra el recuento máximo requerido para cada bloque entre todas las divisiones de 128×128, en vez de la suma.",
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
    title: "Mapeos personalizados",
    tooltip:
      "Agrega mapeos personalizados de Color → Bloque para valores RGB que no forman parte de la paleta estándar.\nEl RGB personalizado se interpreta como el tono base/claro para el color ID.\nLos tonos oscuro y plano se derivan automáticamente usando los multiplicadores estándar.\nUna vez añadido, los tres tonos nuevos estarán disponibles para usar en las imágenes de entrada.",
    ariaLabel: "Información del sombreado de color personalizado",
    customRgbOption: "RGB personalizado",
    blockLabel: "Bloque",
    blockPlaceholder: "p. ej. fart_block",
    usedInImage: {
      one: "{count} color RGB personalizado se usa en esta imagen.",
      other: "{count} colores RGB personalizados se usan en esta imagen.",
    } as PluralForms,
    unusedLabel: {
      one: "{count} color personalizado sin usar (no está en la imagen)",
      other: "{count} colores personalizados sin usar (no están en la imagen)",
    } as PluralForms,
  },
  upload: {
    title: "Vista previa de imagen",
    placeholder: "Haz clic o suelta una imagen de 128×128",
    showVsFillersToggle: "Mostrar VS-Rellenos:",
    showVsFillersTooltip: "Superpone los puntos no transparentes de VS-Relleno sobre la vista previa de la imagen.",
    copyImageUrlTitle: "Copiar la URL compartible de la imagen",
    copiedImageUrlAlert: "¡URL de la imagen copiada al portapapeles!",
    sharedImageName: "imagen-compartida.png",
    removeButton: "Quitar",
    cancelButton: "Cancelar",
    parsing: "Analizando imagen...",
    parsingProgress: "Analizando imagen {completed}/{total}...",
    analyzing: "Generando formas...",
    analyzingProgress: "Generando formas {completed}/{total}...",
    fillerAnalysis: "Calculando requisitos de relleno...",
    fillerAnalysisProgress: "Calculando requisitos de relleno {completed}/{total}...",
    materialAnalysis: "Calculando materiales requeridos...",
    materialAnalysisProgress: "Calculando materiales requeridos {completed}/{total}...",
    convertButtonConverting: "Convirtiendo...",
    convertButtonNbt: "Generar .nbt",
    convertButtonZip: "Generar .zip",
    convertButtonZipCount: "Generar .zip ({count} ids)",
    convertButtonLayerSplit: "Por capas ({count})",
    convertButtonLayerSplitZip: "Por capas .zip ({count})",
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
    iceConversionWarning:
      "Advertencia: Se ha seleccionado hielo para el color del agua.\nEsta construcción contiene pilares de hielo flotantes.\nEl hielo no puede convertirse en agua si el pilar no tiene soporte debajo.",
    noFillerNorthRowLine: "El sombreado de la fila norte requiere colocaciones de relleno.",
    noFillerSuppressLine: "El sombreado de supresión requiere colocaciones de relleno.",
    noFillerInGridLine: "Se requieren algunos rellenos críticos de sombreado dentro de la cuadrícula de 128x128.",
    noFillerWarning: "El relleno de sombra está desactivado ({value}).\n{lines}",
    crubTechBreakableInvalid: {
      one: "Shade/Support-Breakable no es válido ({value}).\n{count} colocación de CrubTech lo requiere.",
      other: "Shade/Support-Breakable no es válido ({value}).\n{count} colocaciones de CrubTech lo requieren.",
    } as PluralForms,
    crubTechPushableInvalid: {
      one: "Shade/Support-Pushable no es válido ({value}).\n{count} colocación de CrubTech lo requiere.",
      other: "Shade/Support-Pushable no es válido ({value}).\n{count} colocaciones de CrubTech lo requieren.",
    } as PluralForms,
    crubTechBreakableBehaviorWarning: {
      one: "Shade/Support-Breakable debería romperse al ser empujado por pistón/slime ({value}).\n{count} colocación de CrubTech lo usa.",
      other: "Shade/Support-Breakable debería romperse al ser empujado por pistón/slime ({value}).\n{count} colocaciones de CrubTech lo usan.",
    } as PluralForms,
    crubTechPushableBehaviorWarning: {
      one: "Shade/Support-Pushable debería seguir siendo empujable por pistón/slime ({value}).\n{count} colocación de CrubTech lo usa.",
      other: "Shade/Support-Pushable debería seguir siendo empujable por pistón/slime ({value}).\n{count} colocaciones de CrubTech lo usan.",
    } as PluralForms,
    waterSideSupportInvalid:
      "El relleno de soporte no es válido ({value}).\nAlgunos soportes laterales de agua requieren un bloque color_id=0, así que esas colocaciones no se contarán ni se exportarán.",
    waterSideSupportNotColorIdZero:
      "El relleno de soporte no es color_id=0 ({value}).\nAlgunos soportes laterales de agua requieren un bloque color_id=0, así que esas colocaciones no se contarán ni se exportarán.",
    fragileSupportOverrideWarningSingle:
      "El soporte para {blockId} debe ser {support}",
    fragileSupportOverrideWarning:
      "El soporte para {blockId} debe ser uno de:\n{supports}",
    vsFillerInvalid: {
      one: "{label} no es válido ({value}).\nHabrá {count} píxel de escalera con sombreado incorrecto.",
      other: "{label} no es válido ({value}).\nHabrá {count} píxeles de escalera con sombreado incorrecto.",
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
      one: "Los VS-Rellenos no son válidos ({first}, {second}). Habrá {count} píxel de escalera con sombreado incorrecto.",
      other:
        "Los VS-Rellenos no son válidos ({first}, {second}). Habrá {count} píxeles de escalera con sombreado incorrecto.",
    } as PluralForms,
    vsFillerTransparentSwap: "Sustituye los VS-Rellenos de sombreado plano por {value}.",
    lateFillerInvalid: {
      one: "El relleno tardío no es válido ({value}).\n{count} punto tardío de supresión requiere sombreado.",
      other: "El relleno tardío no es válido ({value}).\n{count} puntos tardíos de supresión requieren sombreado.",
    } as PluralForms,
    suppressStepNorthSouthWarning:
      "Advertencia: {modeLabel} N→S / S→N coloca bloques norte/sur en la misma fase.\nPara conservar el sombreado, esto hace que algunos bloques se eleven 1 bloque en Y, lo que vuelve la construcción general menos intuitiva y compacta.",
    uniqueColorCount: {
      one: "{count} color único",
      other: "{count} colores únicos",
    } as PluralForms,
    blockTypeCount: {
      one: "{count} tipo de bloque",
      other: "{count} tipos de bloque",
    } as PluralForms,
    voidShadowCount: {
      one: "{count} punto de VS-Relleno",
      other: "{count} puntos de VS-Relleno",
    } as PluralForms,
    stepRangeButton: "Rango de pasos",
    columnRangeButton: "Rango de columnas",
    westEastSlopeButton: "Pendiente W→E",
    westEastSlopeTooltip: "Inclina los bloques generados del mapa de oeste a este antes de exportar.",
    westEastSlopeRunTitle: "Recorrido oeste a este, 0-127; 0 significa cada columna",
    westEastSlopeRiseTitle: "Cambio en Y por recorrido W→E; negativo invierte la inclinación",
  },
  swatches: {
    transparent: "Transparente",
    shadeTooltip: "{shadeId}: {hex} | Haz clic para copiar",
  },
  dialogs: {
    secretSettingsTitle: "Configuración secreta",
    options: {
      showTransparentRow: "Mostrar fila color_id=0",
      showExcludedBlocks: "Mostrar bloques excluidos",
      collapseDuplicateNbtPaletteStates: "Colapsar estados duplicados de la paleta NBT",
      forceXZ128: "Ancho XZ siempre 128",
      forceZ129: "Ancho Z siempre 129",
      assumeFloor: "Suponer suelo",
      belowPlatformWater: "Agua bajo la plataforma",
      skipEmptySuppressSteps: "Omitir pasos suppress vacíos",
      showFlatNbtSuppressStepModes: "Mostrar opciones de suppress (steps) para esquemas planos",
      markSuppressLoadSpotsInSchematic: "Marcar puntos de carga de supresión de color en esquemas",
      suppressLoadSpotMarkerBlock: "Bloque marcador",
      showVsFillerWarnings: "Mostrar advertencias cuando los VS-Rellenos sean necesarios en mapas Staircase",
      showAlignmentReminder: "Mostrar recordatorio de alineación",
      showNooblineWarnings: "Mostrar advertencias para nooblines",
    },
  },
  credits: {
    title: "Créditos",
    evModderName: "EvModder",
    evModderUrl: "https://www.youtube.com/@evmodder",
    evModderRole: "Creador de este sitio-herramienta",
    rebaneName: "Rebane2001",
    rebaneUrl: "https://rebane2001.com/",
    rebaneRole: "Creador original de {name}",
    mapArtCraftName: "MapArtCraft",
    mapArtCraftUrl: "https://mike2b2t.github.io/mapartcraft/",
    gu2t4vName: "Gu2t4v",
    gu2t4vUrl: "https://youtube.com/@gust4v_",
    gu2t4vRole: "Experto en supresión, inventó 2 capas",
    gptNote: "Visuales y código selectivos",
  },
  parsing: {
    unableToCreateImageCanvas: "No se pudo crear el lienzo de la imagen.",
    failedToDecodeImage: "No se pudo decodificar la imagen.",
    browserDecodeFailure: "No se puede decodificar este formato de imagen en el navegador.",
    tiffNoImageData: "El archivo TIFF no contiene datos de imagen.",
    genericDecodeFailure: "No se puede decodificar este formato de imagen.",
    conversionFailed: "La conversión falló",
    imageSizeError: "El ancho y el alto de la imagen deben ser divisibles por 128 (se obtuvo {width}×{height})",
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
    croppedImage: "La imagen se recortó a {width}×{height}.",
    cropRemovedSingleSide: "Se eliminaron {count}px del lado {side}.",
    cropRemovedPairedSides: "Se eliminaron {count}px de la {sides}.",
    cropSideLeft: "izquierdo",
    cropSideRight: "derecho",
    cropSideTop: "superior",
    cropSideBottom: "inferior",
    cropSidesLeftRight: "izquierda/derecha",
    cropSidesTopBottom: "parte superior/inferior",
    reducedUniqueColors: {
      one: "{count} color menos que en la imagen de entrada.",
      other: "{count} colores menos que en la imagen de entrada.",
    } as PluralForms,
    lossyFormatHint: "Esto probablemente se debe a que {formatLabel} es un formato con pérdida.",
  },
} satisfies MessageCatalog;
