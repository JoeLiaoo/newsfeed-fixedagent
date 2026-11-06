import { inflateRawSync } from "node:zlib";

/** 读取 zip 里的文本文件。支持存储和 deflate，文件名按 UTF-8 标志位解码。 */
export function readZipText(buffer: Buffer): Map<string, string> {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  if (count === 0xffff) throw new Error("暂不支持 zip64");
  let offset = buffer.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff) throw new Error("暂不支持 zip64");
  const files = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip 中央目录损坏");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buffer.toString(flags & 0x800 ? "utf8" : "latin1", nameStart, nameStart + nameLength);
    offset = nameStart + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    const bytes = localFile(buffer, localOffset, compressed, method);
    files.set(name.replaceAll("\\", "/"), bytes.toString("utf8"));
  }
  return files;
}

/** 读取二进制条目，给知识库材料包里的原件用。 */
export function readZipBytes(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  if (count === 0xffff) throw new Error("暂不支持 zip64");
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip 中央目录损坏");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buffer.toString(flags & 0x800 ? "utf8" : "latin1", nameStart, nameStart + nameLength);
    offset = nameStart + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    files.set(name.replaceAll("\\", "/"), localFile(buffer, localOffset, compressed, method));
  }
  return files;
}

function localFile(buffer: Buffer, localOffset: number, compressed: number, method: number): Buffer {
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("zip 本地文件头损坏");
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + compressed);
  if (data.length !== compressed) throw new Error("zip 条目长度不足");
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new Error(`不支持的 zip 压缩方式 ${method}`);
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let index = buffer.length - 22; index >= min; index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  }
  throw new Error("找不到 zip 目录结尾");
}
