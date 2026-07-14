declare module 'dcmjs' {
  const dcmjs: {
    data: {
      DicomMessage: {
        readFile: (buffer: ArrayBuffer) => {
          meta: Record<string, unknown>;
          dict: Record<string, { vr: string; Value: unknown[] }>;
        };
      };
      DicomDict: new (meta: Record<string, unknown>) => {
        dict: Record<string, { vr: string; Value: unknown[] }>;
        write: () => ArrayBuffer;
      };
      DicomMetaDictionary: {
        naturalizeDataset: (dict: Record<string, unknown>) => Record<string, unknown>;
        denaturalizeDataset: (dataset: Record<string, unknown>) => Record<string, unknown>;
      };
    };
  };
  export default dcmjs;
}
