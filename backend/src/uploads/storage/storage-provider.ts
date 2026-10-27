export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
export interface StoredObject { key: string; version: number | null; }
export interface StorageProvider {
  readonly name: 'local' | 'cloudinary';
  put(id: string, bytes: Buffer): Promise<StoredObject>;
  read(object: StoredObject): Promise<Buffer>;
}
