import { readSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";

export class StringFileWrapper {
  public readonly buffers = new Map<number, string>();
  public readonly bufferLength: number;
  public readonly chunkPositions = [0];
  public length: number | undefined;
  private readonly text: string | null;
  private readonly fd: number | null;

  public constructor(textOrFd: string | number, chunkLength: number) {
    this.text = typeof textOrFd === "string" ? textOrFd : null;
    this.fd = typeof textOrFd === "number" ? textOrFd : null;
    this.bufferLength = !chunkLength || chunkLength < 2 ? 1_000_000 : chunkLength;
  }

  public static async fromFileHandle(handle: FileHandle, chunkLength: number): Promise<StringFileWrapper> {
    return new StringFileWrapper(handle.fd, chunkLength);
  }

  public getBuffer(index: number): string {
    if (index < 0) {
      throw new Error("Negative indexing is not supported");
    }

    const cached = this.buffers.get(index);
    if (cached !== undefined) {
      return cached;
    }

    this.ensureChunkPosition(index);
    const start = this.chunkPositions[index];
    if (start === undefined || (this.text !== null && start >= this.text.length)) {
      throw new Error("Chunk index out of range");
    }

    const { chunk, nextPosition } = this.readChunk(start);
    if (!chunk) {
      throw new Error("Chunk index out of range");
    }

    this.chunkPositions[index + 1] ??= nextPosition;
    if (chunk.length < this.bufferLength) {
      this.length = index * this.bufferLength + chunk.length;
    }

    this.buffers.set(index, chunk);
    const maxBuffers = Math.max(2, Math.floor(2_000_000 / this.bufferLength));
    if (this.buffers.size > maxBuffers) {
      const oldest = this.buffers.keys().next().value as number | undefined;
      if (oldest !== undefined && oldest !== index) {
        this.buffers.delete(oldest);
      }
    }

    return chunk;
  }

  public get(index: number | sliceLike): string {
    if (typeof index !== "number") {
      const [start, stop, step] = this.normalizeSlice(index);
      if (step === 0) {
        throw new Error("slice step cannot be zero");
      }
      if (step !== 1) {
        let result = "";
        for (let cursor = start; cursor < stop; cursor += step) {
          result += this.get(cursor);
        }
        return result;
      }
      if (start >= stop) {
        return "";
      }
      return this.sliceFromBuffers(start, stop);
    }

    let normalizedIndex = index;
    if (normalizedIndex < 0) {
      normalizedIndex += this.size();
    }
    if (normalizedIndex < 0) {
      throw new Error("string index out of range");
    }
    const bufferIndex = Math.floor(normalizedIndex / this.bufferLength);
    const buffer = this.getBuffer(bufferIndex);
    return buffer[normalizedIndex % this.bufferLength] ?? "";
  }

  public slice(start?: number, end?: number): string {
    return this.get({ start, stop: end });
  }

  public indexOf(searchValue: string, fromIndex = 0): number {
    const totalLength = this.size();
    let start = fromIndex;
    if (start < 0) {
      start = Math.max(totalLength + start, 0);
    }
    if (searchValue === "") {
      return Math.min(start, totalLength);
    }

    const limit = totalLength - searchValue.length;
    for (let cursor = start; cursor <= limit; cursor += 1) {
      if (this.get({ start: cursor, stop: cursor + searchValue.length }) === searchValue) {
        return cursor;
      }
    }

    return -1;
  }

  public size(): number {
    if (this.length === undefined) {
      if (this.text !== null) {
        this.length = this.text.length;
      } else {
        while (this.length === undefined) {
          this.ensureChunkPosition(this.chunkPositions.length);
        }
      }
    }
    return this.length;
  }

  public toString(): string {
    if (this.text !== null) {
      return this.text;
    }
    return this.slice(0, this.size());
  }

  public ensureChunkPosition(chunkIndex: number): void {
    while (this.chunkPositions.length <= chunkIndex) {
      const previousIndex = this.chunkPositions.length - 1;
      const start = this.chunkPositions[this.chunkPositions.length - 1]!;
      const { chunk, nextPosition } = this.readChunk(start);
      if (chunk.length < this.bufferLength) {
        this.length = previousIndex * this.bufferLength + chunk.length;
      }
      this.chunkPositions.push(nextPosition);
      if (!chunk) {
        break;
      }
    }
    if (this.chunkPositions.length <= chunkIndex) {
      throw new Error("Chunk index out of range");
    }
  }

  private normalizeSlice(index: sliceLike): [number, number, number] {
    const totalLength = this.size();
    let start = index.start ?? 0;
    let stop = index.stop ?? totalLength;
    const step = index.step ?? 1;

    if (start < 0) {
      start += totalLength;
    }
    if (stop < 0) {
      stop += totalLength;
    }

    start = Math.max(start, 0);
    stop = Math.min(stop, totalLength);
    return [start, stop, step];
  }

  private sliceFromBuffers(start: number, stop: number): string {
    const bufferIndex = Math.floor(start / this.bufferLength);
    const bufferEnd = Math.floor((stop - 1) / this.bufferLength);
    const startMod = start % this.bufferLength;
    let stopMod = stop % this.bufferLength;
    if (stopMod === 0 && stop > start) {
      stopMod = this.bufferLength;
    }

    if (bufferIndex === bufferEnd) {
      return this.getBuffer(bufferIndex).slice(startMod, stopMod);
    }

    const startSlice = this.getBuffer(bufferIndex).slice(startMod);
    const middle: string[] = [];
    for (let index = bufferIndex + 1; index < bufferEnd; index += 1) {
      middle.push(this.getBuffer(index));
    }
    const endSlice = this.getBuffer(bufferEnd).slice(0, stopMod);
    return startSlice + middle.join("") + endSlice;
  }

  private readChunk(start: number): { chunk: string; nextPosition: number } {
    if (this.text !== null) {
      const chunk = this.text.slice(start, start + this.bufferLength);
      return {
        chunk,
        nextPosition: Math.min(start + chunk.length, this.text.length),
      };
    }

    if (this.fd === null) {
      throw new Error("StringFileWrapper has no backing source");
    }

    const decoder = new TextDecoder("utf8");
    const readSize = Math.max(1024, this.bufferLength * 4);
    const buffer = Buffer.allocUnsafe(readSize);
    let cursor = start;
    let chunk = "";

    while (chunk.length < this.bufferLength) {
      const bytesRead = readSync(this.fd, buffer, 0, buffer.length, cursor);
      if (bytesRead === 0) {
        chunk += decoder.decode();
        break;
      }
      cursor += bytesRead;
      chunk += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
    }

    if (chunk.length <= this.bufferLength) {
      return { chunk, nextPosition: cursor };
    }

    const normalized = chunk.slice(0, this.bufferLength);
    return {
      chunk: normalized,
      nextPosition: start + Buffer.byteLength(normalized, "utf8"),
    };
  }
}

export interface sliceLike {
  start?: number;
  stop?: number;
  step?: number;
}
