// ─────────────────────────────────────────────────────────────
// parts — the static OOXML skeleton of a Canvix PPTX (Wave 5):
// content types, package rels, presentation, slide master,
// slide layout, theme, notes master/slides and doc properties.
// Everything is a builder function so the export orchestrator can
// accumulate slides/media first and stamp the manifest last.
//
// The skeleton is intentionally minimal: one master, one blank
// layout, no placeholders beyond the title/body pair the format
// requires on the master, a complete-but-compact theme. Files
// produced this way open in PowerPoint, Keynote, Google Slides
// and LibreOffice (verified shapes — see docs/PPTX-EXPORT.md).
// ─────────────────────────────────────────────────────────────

import { xesc } from './xml-helpers'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** [Content_Types].xml — defaults for the extensions we emit plus
 *  an override per XML part. */
export function contentTypesXml(slides: string[], notesSlides: string[]): string {
  const hasNotesMaster = notesSlides.length > 0
  const overrides = [
    ...slides.map((p) => partOverride(p, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml')),
    ...notesSlides.map((p) => partOverride(p, 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml')),
    partOverride('/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'),
    partOverride('/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'),
    partOverride('/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'),
    partOverride('/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'),
    ...(hasNotesMaster
      ? [partOverride('/ppt/notesMasters/notesMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml')]
      : []),
    partOverride('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'),
    partOverride('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'),
  ]
  return (
    XML_DECL +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Default Extension="jpg" ContentType="image/jpeg"/>` +
    overrides.join('') +
    `</Types>`
  )
}

function partOverride(part: string, type: string): string {
  return `<Override PartName="${xesc(part)}" ContentType="${xesc(type)}"/>`
}

/** _rels/.rels — the package root. */
export function rootRelsXml(): string {
  const rels = [
    rel('rId1', 'officeDocument', 'ppt/presentation.xml'),
    rel('rId2', 'core-properties', 'docProps/core.xml'),
    rel('rId3', 'extended-properties', 'docProps/app.xml'),
  ]
  return XML_DECL + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
}

function rel(id: string, type: string, target: string, targetMode?: 'External'): string {
  return `<Relationship Id="${xesc(id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${xesc(type)}" Target="${xesc(target)}"${targetMode ? ` TargetMode="${targetMode}"` : ''}/>`
}

/** ppt/presentation.xml — slide size (px → EMU), slide id list,
 *  notes master id list. Slide ids start at 256 (the format's
 *  reserved floor for slides). */
export function presentationXml(
  widthPx: number,
  heightPx: number,
  slideCount: number,
  hasNotesMaster: boolean,
): string {
  const ids = Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')
  return (
    XML_DECL +
    `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    (hasNotesMaster ? `<p:notesMasterIdLst><p:notesMasterId id="2147483649" r:id="rId${slideCount + 2}"/></p:notesMasterIdLst>` : '') +
    `<p:sldIdLst>${ids}</p:sldIdLst>` +
    `<p:sldSz cx="${Math.round(widthPx * 9525)}" cy="${Math.round(heightPx * 9525)}"/>` +
    `<p:notesSz cx="${Math.round(heightPx * 9525)}" cy="${Math.round(widthPx * 9525)}"/>` +
    `</p:presentation>`
  )
}

/** ppt/_rels/presentation.xml.rels — master, slides, notesMaster. */
export function presentationRelsXml(slideCount: number, hasNotesMaster: boolean): string {
  const rels = [rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml')]
  for (let i = 0; i < slideCount; i++) rels.push(rel(`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`))
  if (hasNotesMaster) rels.push(rel(`rId${slideCount + 2}`, 'notesMaster', 'notesMasters/notesMaster1.xml'))
  return XML_DECL + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
}

/** The blank slide layout — one that draws nothing. */
export function slideLayoutXml(): string {
  return (
    XML_DECL +
    `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">` +
    `<p:cSld name="Blank">` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sldLayout>`
  )
}

export function slideLayoutRelsXml(): string {
  return XML_DECL + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')}</Relationships>`
}

/** The slide master — blank, one title/body placeholder pair (the
 *  format expects them; our slides never reference them). */
export function slideMasterXml(): string {
  return (
    XML_DECL +
    `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld>` +
    `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `</p:sldMaster>`
  )
}

export function slideMasterRelsXml(): string {
  return (
    XML_DECL +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') +
    rel('rId2', 'theme', '../theme/theme1.xml') +
    `</Relationships>`
  )
}

/** A complete-but-compact theme (Office's own minimal shape). */
export function themeXml(): string {
  const ns = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Canvix"`
  const clr = (name: string, hex: string) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`
  return (
    XML_DECL +
    `<a:theme ${ns}>` +
    `<a:themeElements>` +
    `<a:clrScheme name="Canvix">` +
    clr('dk1', '000000') +
    clr('lt1', 'FFFFFF') +
    clr('dk2', '1B2A4A') +
    clr('lt2', 'F4E3C1') +
    clr('accent1', '7630D7') +
    clr('accent2', '02C0CC') +
    clr('accent3', 'FF6B5B') +
    clr('accent4', '2E9E8F') +
    clr('accent5', '7A8CA5') +
    clr('accent6', 'F2C94C') +
    `<a:hlink><a:srgbClr val="7A8CA5"/></a:hlink>` +
    `<a:folHlink><a:srgbClr val="5B4B8A"/></a:folHlink>` +
    `</a:clrScheme>` +
    `<a:fontScheme name="Canvix">` +
    `<a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
    `</a:fontScheme>` +
    `<a:fmtScheme name="Canvix">` +
    `<a:fillStyleLst>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill>` +
    `</a:fillStyleLst>` +
    `<a:lnStyleLst>` +
    `<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `<a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `</a:lnStyleLst>` +
    `<a:effectStyleLst>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `</a:effectStyleLst>` +
    `<a:bgFillStyleLst>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"><a:tint val="80000"/></a:schemeClr></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"><a:shade val="70000"/></a:schemeClr></a:solidFill>` +
    `</a:bgFillStyleLst>` +
    `</a:fmtScheme>` +
    `</a:themeElements>` +
    `</a:theme>`
  )
}

/** Notes master (required once any notesSlide exists). */
export function notesMasterXml(): string {
  return (
    XML_DECL +
    `<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld>` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `</p:notesMaster>`
  )
}

export function notesMasterRelsXml(): string {
  return (
    XML_DECL +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rel('rId1', 'theme', '../theme/theme1.xml') +
    `</Relationships>`
  )
}

/** One notes slide: the speaker-note text as plain paragraphs. */
export function notesSlideXml(text: string): string {
  const paras = text
    .split('\n')
    .map((line) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xesc(line)}</a:t></a:r></a:p>`)
    .join('')
  return (
    XML_DECL +
    `<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/>${paras}</p:txBody>` +
    `</p:sp>` +
    `</p:spTree></p:cSld>` +
    `</p:notes>`
  )
}

export function notesSlideRelsXml(slideNumber: number): string {
  return (
    XML_DECL +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rel('rId1', 'notesMaster', '../notesMasters/notesMaster1.xml') +
    rel('rId2', 'slide', `../slides/slide${slideNumber}.xml`) +
    `</Relationships>`
  )
}

/** docProps/core.xml — title + the producing app. */
export function corePropsXml(title: string): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return (
    XML_DECL +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xesc(title)}</dc:title>` +
    `<dc:creator>Canvix</dc:creator>` +
    `<cp:lastModifiedBy>Canvix</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    `</cp:coreProperties>`
  )
}

export function appPropsXml(slideCount: number): string {
  return (
    XML_DECL +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>Canvix</Application>` +
    `<Slides>${slideCount}</Slides>` +
    `</Properties>`
  )
}
