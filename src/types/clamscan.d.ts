declare module "clamscan" {
  type ClamScanResult = { isInfected: boolean; viruses?: string[] | null };
  type ClamScanner = { scanBuffer(buffer: Buffer): Promise<ClamScanResult> };
  export default class NodeClam {
    init(config: unknown): Promise<ClamScanner>;
  }
}