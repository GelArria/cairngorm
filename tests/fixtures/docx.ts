import JSZip from "jszip";

export const WORD_XML = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
export const PARAGRAPH = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

export async function zipFixture(
  files: Record<string, string | Uint8Array>,
  compression: "STORE" | "DEFLATE" = "STORE",
) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) {
    zip.file(name, value, { createFolders: false });
  }
  return zip.generateAsync({ type: "uint8array", compression });
}

export async function docxFixture({
  compression = "STORE",
  extra = {},
}: {
  compression?: "STORE" | "DEFLATE";
  extra?: Record<string, string | Uint8Array>;
} = {}) {
  return zipFixture(
    {
      "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      "_rels/.rels": `<Relationships xmlns="${RELS_NS}"><Relationship Id="doc" Type="${REL_TYPE}officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/_rels/document.xml.rels": `<Relationships xmlns="${RELS_NS}"><Relationship Id="picture" Type="${REL_TYPE}image" Target="media/pixel.png"/><Relationship Id="link" Type="${REL_TYPE}hyperlink" Target="https://example.invalid/docx-external" TargetMode="External"/></Relationships>`,
      "word/document.xml": WORD_XML(`${PARAGRAPH("Quarterly review — España 日本語 🚀")}
<w:p><w:r><w:rPr><w:b/><w:i/><w:color w:val="185FA5"/></w:rPr><w:t>Formatted summary</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${PARAGRAPH("Metric")}</w:tc><w:tc>${PARAGRAPH("Value")}</w:tc></w:tr><w:tr><w:tc>${PARAGRAPH("Coverage")}</w:tc><w:tc>${PARAGRAPH("95%")}</w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Embedded pixel"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Embedded pixel"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="picture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:hyperlink r:id="link"><w:r><w:t>Inert external reference</w:t></w:r></w:hyperlink></w:p>`),
      "word/media/pixel.png": Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)),
      ...extra,
    },
    compression,
  );
}
