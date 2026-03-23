import type { FileHandle } from "node:fs/promises";

export class StringFileWrapper {
  public readonly buffers = new Map<number, string>();
  public readonly bufferLength: number;
  public readonly chunkPositions = [0];
  public length: number | undefined;
  private readonly text: string;

  public constructor(text: string, chunkLength: number) {
    this.text = text;
    this.bufferLength = !chunkLength || chunkLength < 2 ? 1_000_000 : chunkLength;
  }

  public static async fromFileHandle(handle: FileHandle, chunkLength: number): Promise<StringFileWrapper> {
    const text = await handle.readFile({ encoding: "utf8" });
    return new StringFileWrapper(text, chunkLength);
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
    if (start === undefined || start >= this.text.length) {
      throw new Error("Chunk index out of range");
    }

    const chunk = this.text.slice(start, start + this.bufferLength);
    if (!chunk) {
      throw new Error("Chunk index out of range");
    }

    this.chunkPositions[index + 1] ??= Math.min(start + chunk.length, this.text.length);
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

  public size(): number {
    if (this.length === undefined) {
      this.length = this.text.length;
    }
    return this.length;
  }

  public ensureChunkPosition(chunkIndex: number): void {
    while (this.chunkPositions.length <= chunkIndex) {
      const previousIndex = this.chunkPositions.length - 1;
      const start = this.chunkPositions[this.chunkPositions.length - 1]!;
      const chunk = this.text.slice(start, start + this.bufferLength);
      const end = start + chunk.length;
      if (chunk.length < this.bufferLength) {
        this.length = previousIndex * this.bufferLength + chunk.length;
      }
      this.chunkPositions.push(end);
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
}

export interface sliceLike {
  start?: number;
  stop?: number;
  step?: number;
}
