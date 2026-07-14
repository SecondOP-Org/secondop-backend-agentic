declare module 'dicom-parser' {
  interface DicomElement {
    dataOffset?: number;
    length?: number;
    vm?: number;
    items?: Array<{ dataSet?: DicomDataSet }>;
  }

  interface DicomDataSet {
    string(tag: string): string | undefined;
    uint16(tag: string): number | undefined;
    elements: Record<string, DicomElement | undefined>;
    byteArray: Uint8Array;
  }

  export function parseDicom(byteArray: Uint8Array): DicomDataSet;
  const dicomParser: {
    parseDicom: typeof parseDicom;
  };
  export default dicomParser;
}
