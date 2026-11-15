export type LocalMaterial = {
  id: string;
  routeId: string;
  stopId: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
};
type StoredMaterial = LocalMaterial & { blob: Blob };
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("carmeleon-phone-materials", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("originals", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "파일 저장소를 열지 못했어요. 브라우저 저장 공간을 확인해 주세요.",
        ),
      );
  });
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("originals", mode);
    const request = action(tx.objectStore("originals"));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        new Error(
          "파일을 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요.",
        ),
      );
    };
  });
}
export const listLocalMaterials = async (): Promise<LocalMaterial[]> =>
  (
    await transaction<StoredMaterial[]>("readonly", (store) => store.getAll())
  ).map(({ blob: _blob, ...metadata }) => metadata);
export async function saveLocalMaterial(
  file: File,
  routeId: string,
  stopId: string,
): Promise<LocalMaterial> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("파일은 20MB까지 추가할 수 있어요.");
  const metadata: LocalMaterial = {
    id: crypto.randomUUID(),
    routeId,
    stopId,
    name: file.name,
    size: file.size,
    type: file.type,
    createdAt: new Date().toISOString(),
  };
  await transaction("readwrite", (store) =>
    store.add({ ...metadata, blob: file }),
  );
  return metadata;
}
export async function downloadLocalMaterial(id: string) {
  const file = await transaction<StoredMaterial | undefined>(
    "readonly",
    (store) => store.get(id),
  );
  if (!file)
    throw new Error("원본 파일이 이 브라우저에 없어요. 다시 첨부해 주세요.");
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const deleteLocalMaterial = (id: string) =>
  transaction("readwrite", (store) => store.delete(id));

export async function readLocalMaterial(id: string): Promise<Blob | undefined> {
  return (await transaction<StoredMaterial | undefined>("readonly", store => store.get(id)))?.blob;
}
