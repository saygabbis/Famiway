declare module "./server/drive.mjs" {
  export function extractFolderId(input: string): string;
  export function listFolder(folderId: string): Promise<{
    id: string;
    title: string;
    videos: Array<{
      id: string;
      name: string;
      mimeType: string;
      size: number;
      createdTime: number;
      modifiedTime: number;
    }>;
  }>;
  export function handleApi(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<boolean>;
}
